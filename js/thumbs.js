// 🖼️ صور مصغّرة (Thumbnails) للشورتس والريلز ويوتيوب — بترسم على canvas من الخلفية الحالية + عنوان كبير
import { QURAN_FONT, TEXT_FONT, drawBackground } from './slides.js';

export const THUMB_SIZES = {
  cover: { w: 1080, h: 1920, name: 'غلاف شورتس / ريلز / تيك توك (9:16)' },
  yt: { w: 1280, h: 720, name: 'صورة يوتيوب العادية (16:9)' },
  square: { w: 1080, h: 1080, name: 'مربع — بوست فيسبوك وإنستجرام (1:1)' },
};

export const THUMB_STYLES = {
  bold: 'عنوان كبير بخط عريض',
  ayah: 'الآية في النص',
  band: 'شريط ملوّن',
  minimal: 'هادي وبسيط',
};

// تقسيم النص على سطور بعرض معيّن
function lines(g, text, maxW) {
  const out = [];
  for (const para of String(text).split(/\n+/)) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
  }
  return out;
}

// أكبر خط يخلّي النص يدخل في عدد سطور وارتفاع معيّن
function fit(g, text, font, weight, maxW, maxH, maxSize, maxLines = 3) {
  let size = maxSize, ls;
  for (; size > 18; size *= 0.93) {
    g.font = `${weight} ${Math.round(size)}px ${font}`;
    ls = lines(g, text, maxW);
    if (ls.length <= maxLines && ls.length * size * 1.35 <= maxH) break;
  }
  return { size: Math.round(size), ls };
}

// نص بحدود سميكة (مقروء فوق أي خلفية)
function strokeText(g, text, x, y, size, fill, stroke = 'rgba(0,0,0,.85)') {
  g.lineJoin = 'round';
  g.lineWidth = Math.max(4, size * 0.14);
  g.strokeStyle = stroke;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

// o: { style, headline, sub, ayah, handle, accent, textColor, dim, media, baseStyle }
export function drawThumb(g, W, H, o) {
  const u = Math.min(W, H) / 1080, portrait = H > W;
  g.save();
  g.clearRect(0, 0, W, H);
  drawBackground(g, W, H, o.baseStyle, o.media);
  // تعتيم + تدرّج تحت + vignette عشان الكلام يبان
  g.fillStyle = `rgba(0,0,0,${o.dim ?? 0.3})`; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, H * 0.45, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const vig = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig; g.fillRect(0, 0, W, H);

  g.direction = 'rtl'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 24 * u;
  const accent = o.accent || '#f4d58d', white = o.textColor || '#ffffff';
  const padX = W * (portrait ? 0.08 : 0.07), maxW = W - padX * 2;
  // في الغلاف الطولي: الكلام في النص بالظبط عشان لما المنصة تقص مربع (شبكة البروفايل) يفضل باين
  const midTop = portrait ? H * 0.3 : H * 0.12, midH = portrait ? H * 0.4 : H * 0.76;

  if (o.style === 'ayah' && o.ayah) {
    const a = fit(g, `﴿ ${o.ayah} ﴾`, QURAN_FONT, 400, maxW, midH * 0.62, 120 * u, 4);
    const ah = a.ls.length * a.size * 1.45;
    let y = midTop + (midH - ah) / 2 + a.size * 0.7;
    g.font = `400 ${a.size}px ${QURAN_FONT}`;
    for (const l of a.ls) { g.fillStyle = white; g.fillText(l, W / 2, y); y += a.size * 1.45; }
    if (o.headline) {
      g.font = `700 ${Math.round(44 * u)}px ${TEXT_FONT}`;
      const tw = Math.min(maxW, g.measureText(o.headline).width + 60 * u), th = 76 * u, ty = midTop - th - 10 * u;
      g.shadowBlur = 0;
      g.fillStyle = accent; g.beginPath(); g.roundRect((W - tw) / 2, ty, tw, th, th / 2); g.fill();
      g.fillStyle = '#111'; g.fillText(o.headline, W / 2, ty + th / 2 + 3 * u);
    }
  } else if (o.style === 'band' && o.headline) {
    const h = fit(g, o.headline, TEXT_FONT, 800, maxW, midH * 0.5, 110 * u, 2);
    const bh = h.ls.length * h.size * 1.35 + 60 * u, by = midTop + (midH - bh) / 2;
    g.shadowBlur = 0;
    g.fillStyle = accent; g.fillRect(0, by, W, bh);
    g.fillStyle = 'rgba(0,0,0,.15)'; g.fillRect(0, by + bh - 10 * u, W, 10 * u);
    g.font = `800 ${h.size}px ${TEXT_FONT}`; g.fillStyle = '#111';
    let y = by + 30 * u + h.size * 0.68;
    for (const l of h.ls) { g.fillText(l, W / 2, y); y += h.size * 1.35; }
    if (o.ayah) {
      g.shadowBlur = 24 * u;
      const a = fit(g, `﴿ ${o.ayah} ﴾`, QURAN_FONT, 400, maxW, midH * 0.3, 64 * u, 2);
      g.font = `400 ${a.size}px ${QURAN_FONT}`; g.fillStyle = white;
      let ay = by - 20 * u - (a.ls.length - 1) * a.size * 1.4;
      for (const l of a.ls) { g.fillText(l, W / 2, ay); ay += a.size * 1.4; }
    }
  } else {
    // bold / minimal: العنوان الكبير
    const bold = o.style !== 'minimal';
    if (o.headline) {
      const h = fit(g, o.headline, TEXT_FONT, bold ? 800 : 600, maxW, midH * (o.ayah ? 0.55 : 0.8), (bold ? 150 : 96) * u, 3);
      const hh = h.ls.length * h.size * 1.32;
      let y = midTop + (midH - hh) / 2 + h.size * 0.66 - (o.ayah ? midH * 0.1 : 0);
      g.font = `${bold ? 800 : 600} ${h.size}px ${TEXT_FONT}`;
      h.ls.forEach((l, i) => {
        if (bold) strokeText(g, l, W / 2, y, h.size, i === 0 ? accent : white);
        else { g.fillStyle = white; g.fillText(l, W / 2, y); }
        y += h.size * 1.32;
      });
      if (o.ayah) {
        const a = fit(g, `﴿ ${o.ayah} ﴾`, QURAN_FONT, 400, maxW * 0.92, midH * 0.28, 66 * u, 2);
        g.font = `400 ${a.size}px ${QURAN_FONT}`; g.fillStyle = white;
        y += a.size * 0.4;
        for (const l of a.ls) { g.fillText(l, W / 2, y); y += a.size * 1.4; }
      }
    }
  }
  // السطر الصغير (السورة والقارئ) والحساب
  g.shadowBlur = 12 * u;
  if (o.sub) {
    g.font = `600 ${Math.round(40 * u)}px ${TEXT_FONT}`;
    const sw = Math.min(maxW, g.measureText(o.sub).width + 56 * u), sh = 70 * u;
    const sy = portrait ? H * 0.74 : H * 0.84;
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.roundRect((W - sw) / 2, sy, sw, sh, sh / 2); g.fill();
    g.fillStyle = accent; g.fillText(o.sub, W / 2, sy + sh / 2 + 3 * u);
  }
  if (o.handle) {
    g.shadowBlur = 8 * u;
    g.font = `500 ${Math.round(30 * u)}px ${TEXT_FONT}`;
    g.fillStyle = 'rgba(255,255,255,.8)';
    g.direction = 'ltr'; // عشان «@» تفضل في أول اسم الحساب
    g.fillText(o.handle, W / 2, H - (portrait ? 0.08 : 0.05) * H);
  }
  g.restore();
}
