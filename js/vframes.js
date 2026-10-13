// إطارات فيديو الخلفية وقت التصدير بـ Mediabunny (MPL-2.0، في vendor/mediabunny)
// بدل ما نعمل seek لكل إطار (بطيء جدًا)، بنفك الفيديو بالترتيب: أسرع ~20 مرة في تجربتنا.
// requests: كل الأوقات المطلوبة من الفيديو ده بنفس ترتيب الطلب وقت التصدير (بالثواني، من أول الفيديو).
// بيرجع { next(): Promise<canvas|null>, close() } — كل next() بيدي الإطار اللي عليه الدور.
export async function videoFrames(url, requests) {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import('../vendor/mediabunny/mediabunny.min.mjs');
  const blob = await (await fetch(url)).blob();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) throw new Error('mediabunny: مش قادر يفك الفيديو ده');
  const dur = Math.max(0.05, await track.computeDuration());
  const start = await track.getFirstTimestamp();
  // نفس منطق seekVideo: الفيديو بيلف لو أقصر من المدة المطلوبة
  const times = requests.map(t => start + Math.min(Math.max(0, t % dur), Math.max(0, dur - 0.04)));
  const sink = new CanvasSink(track, { poolSize: 3 });
  const it = sink.canvasesAtTimestamps(times)[Symbol.asyncIterator]();
  let last = null;
  return {
    async next() {
      const r = await it.next();
      if (!r.done && r.value) last = r.value.canvas;
      return last;
    },
    close() { it.return?.(); input.dispose?.(); },
  };
}
