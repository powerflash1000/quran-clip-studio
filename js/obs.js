// التحكم في OBS من البرنامج — obs-websocket v5 (جوه OBS 28 وأحدث: Tools ← WebSocket Server Settings)
// الاتصال بيروح للجهاز نفسه بس (ws://127.0.0.1:4455)، والباسورد بيتحفظ في المتصفح ده
const enc = new TextEncoder();
const sha256b64 = async s => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))));

export class OBS {
  constructor() { this.ws = null; this.pending = new Map(); this.n = 0; this.onEvent = null; this.onClose = null; this.ready = false; }

  connect(url = 'ws://127.0.0.1:4455', password = '') {
    this.close();
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('عنوان الاتصال غلط')); return; }
      this.ws = ws;
      const fail = msg => { reject(new Error(msg)); try { ws.close(); } catch { /* */ } };
      const timer = setTimeout(() => fail('OBS مش بيرد. اتأكد إن OBS مفتوح، وإن WebSocket Server متفعّل (Tools ← WebSocket Server Settings)'), 6000);
      ws.onerror = () => { clearTimeout(timer); fail('مقدرتش أوصل لـ OBS. افتح OBS، وفعّل Tools ← WebSocket Server Settings ← Enable WebSocket server'); };
      ws.onclose = ev => {
        clearTimeout(timer);
        const was = this.ready;
        this.ready = false;
        for (const p of this.pending.values()) p.reject(new Error('الاتصال بـ OBS اتقطع'));
        this.pending.clear();
        if (ev.code === 4009) fail('باسورد OBS غلط');
        if (was) this.onClose?.();
      };
      ws.onmessage = async ev => {
        const m = JSON.parse(ev.data);
        if (m.op === 0) { // Hello
          const d = { rpcVersion: 1, eventSubscriptions: 1 | 64 }; // General + Outputs
          if (m.d.authentication) {
            if (!password) { clearTimeout(timer); fail('OBS طالب باسورد — اكتبه (من Tools ← WebSocket Server Settings ← Show Connect Info)'); return; }
            const { challenge, salt } = m.d.authentication;
            d.authentication = await sha256b64((await sha256b64(password + salt)) + challenge);
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) { // Identified
          clearTimeout(timer);
          this.ready = true;
          resolve(this);
        } else if (m.op === 7) { // RequestResponse
          const p = this.pending.get(m.d.requestId);
          if (!p) return;
          this.pending.delete(m.d.requestId);
          if (m.d.requestStatus?.result) p.resolve(m.d.responseData || {});
          else p.reject(new Error(m.d.requestStatus?.comment || `OBS رفض الطلب (${m.d.requestStatus?.code})`));
        } else if (m.op === 5) this.onEvent?.(m.d.eventType, m.d.eventData || {});
      };
    });
  }

  call(requestType, requestData = {}) {
    if (!this.ready) return Promise.reject(new Error('OBS مش متوصّل'));
    const requestId = 'r' + (++this.n);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
      setTimeout(() => { if (this.pending.delete(requestId)) reject(new Error('OBS ماردّش')); }, 8000);
    });
  }

  close() { try { this.ws?.close(); } catch { /* */ } this.ws = null; this.ready = false; }
}
