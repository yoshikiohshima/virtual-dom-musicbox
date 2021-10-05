class MusicBoxModel {
    init() {
        if (this._get("wrapTime") === undefined) {
            this._set("wrapTime", 0);

            const width = 720;
            const height = 480;
            const BallDiameter = 25;
            const balls = new Map();

            this._set("width", width);
            this._set("height", height);
            this._set("balls", balls);
            this._set("currentId", 0);
            this._set("BallDiameter", BallDiameter);

            // {x: normalizedPos, n: note}. x is normalized to [0, width - BallDiameter * 2]. f is converted to y which is with in (height - BallDiameter... 0)
            [
                {x: 0.000, n: 'C'},
                {x: 0.125, n: 'D'},
                {x: 0.250, n: 'E'},
                {x: 0.375, n: 'F'},
                {x: 0.500, n: 'G'},
                {x: 0.625, n: 'A'},
                {x: 0.750, n: 'B'},
                {x: 0.875, n: 'C^'},
            ].forEach(obj => {
                const newId = this._get("currentId") + 1;
                this._set("currentId", newId);
                balls.set(newId, {
                    x: obj.x * (width - BallDiameter * 2),
                    y: height - (this.ftop(this.stof(obj.n)) * (height - BallDiameter * 2)) - BallDiameter * 2,
                    grabbed: null});
            });

            const addContainer = this.createElement("div");
            addContainer.domId = "addContainer";
            addContainer.setCode("musicbox.AddPieceModel");
            addContainer.setViewCode("musicbox.AddPieceView");
            this.appendChild(addContainer);

            const bar = this.createElement("bar");
            bar.domId = "bar";
            this.appendChild(bar);

            this.future(2000).call("MusicBoxModel", "wrap");
        }

        this.subscribe(this.id, "grab", "grab");
        this.subscribe(this.id, "move", "move");
        this.subscribe(this.id, "release", "release");
        this.subscribe(this.id, "addBall", "addBall");
        this.subscribe(this.id, "removeBall", "removeBall");
        this.subscribe(this.sessionId, "view-exit", "deleteUser");
        this.style.setProperty("width", `${this._get("width")}px`);
        this.style.setProperty("height", `${this._get("height")}px`);
    }

    deleteUser(viewId) {
        this._get("balls").forEach(value => {
            if (value.grabbed === viewId) {
                value.grabbed = null;
            }
        });
    }

    grab(data) {
        const {viewId, id} = data;
        const ball = this._get("balls").get(id);
        if (!ball) {return;}
        if (ball.grabbed) {return;}
        ball.grabbed = viewId;
        this.publish(this.id, "grabbed", data);
    }

    move(data) {
        const {viewId, id, x, y} = data;
        const ball = this._get("balls").get(id);
        if (!ball) {return;}
        if (ball.grabbed !== viewId) {return;}
        ball.x = x;
        ball.y = y;
        this.publish(this.id, "moved", data);
    }

    release(data) {
        const {viewId, id} = data;
        const ball = this._get("balls").get(id);
        if (!ball) {return;}
        if (ball.grabbed !== viewId) {return;}
        ball.grabbed = null;
        ball.x = Math.min(ball.x, this._get("width") - this._get("BallDiameter"));
        this.publish(this.id, "released", data);
    }

    addBall(data) {
        const id = this.currentId++;
        const width = this._get("width");
        const x = data.x || width / 2;
        const y = data.y || width / 2;
        this._get("balls").set(id, {x, y, grabbed:null});

        const result = {...data, id};
        this.publish(this.id, "added", result);
    }

    removeBall(data) {
        const {viewId, id} = data;
        const ball = this._get("balls").get(id);
        if (!ball) {return;}
        if (ball.grabbed !== viewId) {return;}
        this._get("balls").delete(id);

        this.publish(this.id, "removed", {viewId, id});
    }

    wrap() {
        this._set("wrapTime", (this.now() / 1000.0));
        this.future(2000).call("MusicBoxModel", "wrap");
        this.publish(this.id, "wrap", this._get("wrapTime"));
    }

    stof(s) {
        const scale = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B', 'C^'];
        const index = scale.indexOf(s);
        return 1.0594630943592953 ** index * 261.63;
    }

    ftop(f) {
        // log_1.059 p = log p / log 1.059
        const p = f / 261.63;
        return Math.log(p) / Math.log(1.0594630943592953) / 12.0;
    }

    ptof(p) {
        return 1.0594630943592953 ** (p * 12) * 261.63;
    }
}

class MusicBoxView {
    init() {
        this.wrapTime = 0;
        this.lastWrapTime = this.wrapTime;
        this.lastWrapRealTime = Date.now();
        this.barPos = 0;

        this.audioContext = null;

        this.grabInfo = new Map();
        this.viewBalls = new Map(this.model._get("balls"));
        this.balls = null; // will be a Map() <id, dom>

        this.subscribe(this.model.id, "wrap", "setWrapTime");
        this.subscribe(this.model.id, "grabbed", "grabBall");
        this.subscribe(this.model.id, "moved", "moveBall");
        this.subscribe(this.model.id, "released", "releaseBall");
        this.subscribe(this.model.id, "added", "addBall");
        this.subscribe(this.model.id, "removed", "removeBall");

        this.addEventListener("pointerdown", "pointerDown");
        this.addEventListener("pointermove", "pointerMove");
        this.addEventListener("pointerup", "pointerUp");

        this.BallDiameter = this.model._get("BallDiameter");

        this.initializeBalls();

        if (!this.animationFrameStarted) {
            this.animationFrameStarted = true;
            this.animationFrame();
        }

        window.topView.detachCallbacks.push(() => this.detach());
        window.view = this;
    }

    initializeBalls() {
        this.balls = new Map();
        for (const id of this.viewBalls.keys()) {
            this.newBall(id);
        }
    }

    animationFrame() {
        if (!this.animationFrameStarted) {return;}
        this.update();
        window.requestAnimationFrame(() => this.animationFrame());
    }

    detach() {
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.animationFrameStarted = false;
    }

    setWrapTime(time) {
        this.wrapTime = time;
    }

    newBall(id) {
        const ball = document.createElement("div");
        ball.classList.add("piece");
        this.balls.set(id, ball);
        this.dom.appendChild(ball);
        this.updateBall(id);
    }

    grabBall(data, viewSide) {
        const {viewId, id} = data;
        if (!viewSide && viewId === this.viewId) {return;}

        const ball = this.viewBalls.get(id);
        this.viewBalls.set(id, {...ball, grabbed: viewId});
        this.updateBall(id);
    }

    moveBall(data, viewSide) {
        const {viewId, id, x, y} = data;
        if (!viewSide && viewId === this.viewId) {return;}
        this.viewBalls.set(id, {x, y, grabbed: viewId});
        this.updateBall(id);
    }

    releaseBall(data, viewSide) {
        const {viewId, id} = data;
        if (viewSide && viewId === this.viewId) {return;}
        const ball = this.viewBalls.get(id);
        if (ball) {
            this.viewBalls.set(id, {...ball, grabbed: null});
            this.updateBall(id);
        }
    }

    addBall(data) {
        const {id, x, y} = data;
        this.viewBalls.set(id, {x, y, grabbed: null});
        this.newBall(id);
    }

    removeBall(data) {
        const {id} = data;
        this.viewBalls.delete(id);
        const ball = this.balls.get(id);
        if (ball) {
            ball.remove();
            this.balls.delete(id);
        }
    }

    findBall(x, y, balls) {
        const entries = Array.from(balls.entries());
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            const diffX = (entry[1].x + this.BallDiameter) - x;
            const diffY = (entry[1].y + this.BallDiameter) - y;
            if ((diffX * diffX + diffY * diffY) <= this.BallDiameter ** 2) {
                return entry;
            }
        }
        return null;
    }

    addingBall() {
        this.publish(this.model.id, "addBall", {
            viewId: this.viewId,
            x: this.BallDiameter * 2,
            y: this.BallDiameter * 2,
        });
    }

    updateBall(id) {
        const ballData = this.viewBalls.get(id);
        if (!ballData) {return;}

        const ball = this.balls.get(id);
        if (!ball) {return;}

        const border = !ballData.grabbed ? "" : (ballData.grabbed === this.viewId ? "1px solid red" : "1px solid black");
        const transform = `translate(${ballData.x}px, ${ballData.y}px)`;

        ball.style.setProperty("border", border);
        ball.style.setProperty("transform", transform);
    }

    pointerDown(evt) {
        this.enableSound();
        const x = evt.offsetX;
        const y = evt.offsetY;
        const pointerId = evt.pointerId;
        const balls = this.model._get("balls");
        const entry = this.findBall(x, y, balls);
        if (!entry) {return;}
        const [ballId, ballData] = entry;
        if (ballData.grabbed && ballData.grabbed !== this.viewId) {return;}
        const info = this.grabInfo.get(pointerId);
        if (info) {return;}
        const g = {ballId: entry[0], grabPoint: {x, y}, translation: {x: ballData.x, y: ballData.y}};

        this.grabInfo.set(evt.pointerId, g);
        this.viewBalls.get(ballId).grabbed = this.viewId;
        this.publish(this.model.id, "grab", {viewId: this.viewId, id: ballId});
        this.updateBall(ballId);
        this.setPointerCapture(evt.pointerId);
    }

    pointerMove(evt) {
        if (evt.buttons === 0) {return;}
        const pointerId = evt.pointerId;
        const info = this.grabInfo.get(pointerId);
        if (!info) {return;}

        const ball = this.model._get("balls").get(info.ballId);
        if (!ball) {return;}
        if (ball.grabbed && ball.grabbed !== this.viewId) {return;}

        let x = evt.offsetX - info.grabPoint.x + info.translation.x;
        let y = evt.offsetY - info.grabPoint.y + info.translation.y;
        if (x <= 0) {x = 0;}
        // if (x > model.width - BallDiameter) {x = model.width - BallDiameter;}
        const height = this.model._get("height");
        if (y <= 0) {y = 0;}
        if (y > height - this.BallDiameter * 2) {y = height - this.BallDiameter * 2;}

        this.viewBalls.set(info.ballId, {x, y, grabbed: info.grabbed});
        this.publish(this.model.id, "move", {viewId: this.viewId, id: info.ballId, x, y});
        this.updateBall(info.ballId);
    }

    pointerUp(evt) {
        const pointerId = evt.pointerId;
        const info = this.grabInfo.get(pointerId);
        if (!info) {return;}
        this.releasePointerCapture(pointerId);

        this.grabInfo.delete(evt.pointerId);
        if (this.viewBalls.get(info.ballId)) {
            this.viewBalls.get(info.ballId).grabbed = null;
        }

        const ballData = this.viewBalls.get(info.ballId);
        if (!ballData) {return;}
        if (ballData.x > this.model._get("width")) {
            this.publish(this.model.id, "removeBall", {viewId: this.viewId, id: info.ballId});
        }
        this.publish(this.model.id, "release", {viewId: this.viewId, id: info.ballId});
        this.updateBall(info.ballid);
    }

    update(_time) {
        const updateNow = Date.now();
        const barTiming = (updateNow - this.lastWrapRealTime) / 2000;
        const newBarPos = barTiming * this.model._get("width"); // be [0..model.width+)
        const toPlay = [];
        const oldBarPos = this.barPos;
        const width = this.model._get("width");
        const height = this.model._get("height");
        this.viewBalls.forEach(ballData => {
            if ((oldBarPos <= ballData.x && ballData.x < newBarPos) ||
                (oldBarPos > newBarPos && ballData.x < newBarPos)) {
                toPlay.push((height - ballData.y) / height);
            }
        });
        this.playSound(toPlay);
        this.barPos = newBarPos;
        if (!this.bar) {
            this.bar = this.querySelector("#bar").dom;
        }
        this.bar.style.setProperty("transform", `translate(${newBarPos}px, 0px)`);

        if (this.lastWrapTime !== this.wrapTime) {
            this.lastWrapTime = this.wrapTime;
            const now = Date.now();
            this.lastWrapRealTime = now;
        }

        const scale = Math.min(1, window.innerWidth / width, window.innerHeight / height);

        this.dom.style.transform = `scale(${scale})`;
        this.dom.style.width = `${width}px`;
        this.dom.style.height = `${height}px`;
    }

    synced(flag) {
        console.log("synced", flag, this.barPos);
    }

    enableSound() {
        if (this.audioContext) {return;}
        if (window.AudioContext) {
            this.audioContext = new window.AudioContext();
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }
    }

    playSound(toPlay) {
        if (!this.audioContext) {return;}
        const now = this.audioContext.currentTime;
        toPlay.forEach(p => {
            if (!this.audioContext) {return;}// a dubious line
            const f = this.model.call("MusicBoxModel", "ptof", p);
            const o = this.audioContext.createOscillator();
            o.type = "sine";

            o.frequency.setValueAtTime(f, now);

            const g = this.audioContext.createGain();
            g.gain.setValueAtTime(0.0, now);
            g.gain.linearRampToValueAtTime(0.2, now + 0.1);
            o.connect(g);
            g.connect(this.audioContext.destination);
            o.start(0, 0, 2);

            const stopTone = () => {
                if (!this.audioContext) {return;}
                const future = this.audioContext.currentTime;
                //g.gain.cancelScheduledValues(future);
                g.gain.setValueAtTime(g.gain.value, future);
                g.gain.exponentialRampToValueAtTime(0.00001, future + 1.0);
                o.stop(future + 1);
            };
            setTimeout(stopTone, 100);
        });
    }
}

class AddPieceModel {
    init() {
        if (!this.querySelector("#piece")) {
            const piece = this.createElement("div");
            piece.classList.add("piece");
            this.appendChild(piece);
            this.classList.add("addContainer");
        }
    }
}

class AddPieceView {
    init() {
        this.field = this.parentNode;
        this.addEventListener("click", "addBall");
    }

    addBall() {
        this.field.call("MusicBoxView", "addingBall");
    }
}

function start(parent, _json, _persist) {
    parent.domId = "all";

    const field = parent.createElement("div");
    field.setCode("musicbox.MusicBoxModel");
    field.setViewCode("musicbox.MusicBoxView");
    field.domId = "field";
    parent.appendChild(field);
}

export const musicbox = {
    expanders: [MusicBoxModel, MusicBoxView, AddPieceModel, AddPieceView],
    functions: [start],
};
