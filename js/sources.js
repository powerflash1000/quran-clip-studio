// 📚 المصادر والحقوق: كل مصدر بيستخدمه البرنامج أو ينفع لمحتوى القناة، وحالة رخصته
// ok = رخصة مفتوحة وتنفع لقناة عليها أرباح • cond = مسموح بشروط • personal = للاستخدام الشخصي/مش معروفة
// الحالة دي ملخص من صفحات المصادر نفسها (نوفمبر 2026) — مش استشارة قانونية

export const STATUS = {
  ok: { icon: '✅', name: 'مفتوح' },
  cond: { icon: '⚠️', name: 'بشروط' },
  personal: { icon: '❌', name: 'شخصي / غير معروف' },
};

export const SOURCES = [
  {
    group: 'القرآن', items: [
      { name: 'نص المصحف — مجمع الملك فهد (QuranEnc) عن طريق quran-json', status: 'cond', inApp: true, url: 'https://quranenc.com/',
        note: 'مسموح النشر من غير أي تعديل أو حذف أو إضافة، مع ذكر المصدر.', credit: 'نص المصحف: مجمع الملك فهد لطباعة المصحف الشريف (QuranEnc)' },
      { name: 'Tanzil — نص المصحف', status: 'ok', url: 'https://tanzil.net/',
        note: 'رخصة CC BY 3.0: النسخ الحرفي مسموح من غير تعديل، مع ذكر tanzil.net.', credit: 'نص المصحف: Tanzil.net' },
      { name: 'توقيت الكلمات — quran-align', status: 'ok', inApp: true, url: 'https://github.com/cpfair/quran-align',
        note: 'رخصة CC BY 4.0.', credit: '' },
      { name: 'تلاوات EveryAyah.com', status: 'personal', inApp: true, url: 'https://everyayah.com/',
        note: 'مفيش رخصة منشورة للتسجيلات، وبعضها عليه Claim في يوتيوب. أأمن حاجة تلاوتك أنت (🎧 اقرا ورا الشيخ).', credit: 'التلاوة: EveryAyah.com' },
      { name: 'QuranicAudio.com', status: 'personal', url: 'https://quranicaudio.com/about',
        note: 'مكتوب عندهم: للاستخدام الشخصي.', credit: '' },
    ],
  },
  {
    group: 'التفسير والترجمة', items: [
      { name: 'ترجمات معاني القرآن — QuranEnc', status: 'cond', url: 'https://quranenc.com/',
        note: 'مسموح التنزيل وإعادة النشر من غير تعديل، مع ذكر المصدر.', credit: 'ترجمة المعاني: QuranEnc.com' },
      { name: 'التفاسير القديمة (ابن كثير، الطبري، القرطبي، البغوي، الجلالين)', status: 'cond', inApp: true, url: 'https://quran.com/',
        note: 'نص المؤلفين حر، لكن النسخة الرقمية والتحقيق ممكن يكون ليهم حقوق. انقل تفسير آية أو اتنين مع اسم الكتاب، مش كتب كاملة.', credit: '' },
      { name: 'التفاسير الحديثة (الميسّر، المختصر، السعدي، الوسيط)', status: 'cond', inApp: true, url: 'https://quran.com/',
        note: 'ليها حقوق لأصحابها. الاقتباس القصير مع ذكر الكتاب بس.', credit: '' },
    ],
  },
  {
    group: 'الحديث والأدعية', items: [
      { name: 'hadith-api — fawazahmed0', status: 'ok', inApp: true, url: 'https://github.com/fawazahmed0/hadith-api',
        note: 'رخصة Unlicense (ملكية عامة). أدعية السنة اللي في البرنامج جاية منه.', credit: 'نص الحديث: hadith-api (fawazahmed0)' },
      { name: 'حصن المسلم — azkar-db', status: 'ok', inApp: true, url: 'https://github.com/osamayy/azkar-db',
        note: 'بيانات مجانية من غير قيود استخدام.', credit: 'الأذكار: حصن المسلم' },
      { name: 'sunnah.com', status: 'cond', url: 'https://sunnah.com/about',
        note: 'مسموح نقل أحاديث بعينها للتعليم والعرض، مش النقل بالجملة. والترجمات الإنجليزي ليها حقوق.', credit: 'المصدر: sunnah.com' },
      { name: 'HadeethEnc — موسوعة الأحاديث المترجمة', status: 'cond', url: 'https://hadeethenc.com/',
        note: 'مجاني، وليه صفحة شروط — اقراها قبل النقل. اذكر المصدر دايمًا.', credit: 'المصدر: HadeethEnc.com' },
      { name: 'الدرر السنية — dorar.net', status: 'cond', url: 'https://dorar.net/',
        note: 'ممتاز للتأكد من درجة الحديث. انقل الحكم مع ذكر الموقع.', credit: '' },
    ],
  },
  {
    group: 'الكتب والقصص', items: [
      { name: 'ويكي مصدر — قصص الأنبياء لابن كثير وغيرها', status: 'ok', inApp: true, url: 'https://ar.wikisource.org/',
        note: 'كتب انتهت حقوقها (ملكية عامة). أأمن حاجة تكتب القصة بأسلوبك من النص الأصلي.', credit: 'المصدر: ويكي مصدر (ar.wikisource.org)' },
      { name: 'OpenITI — نصوص عربية تراثية', status: 'cond', url: 'https://kitab-project.org/docs/openITI',
        note: 'الرخص المكتوبة متضاربة وبعضها لغير الأغراض التجارية. للقراية والبحث.', credit: '' },
      { name: 'المكتبة الشاملة', status: 'personal', url: 'https://shamela.ws/',
        note: 'مفيش رخصة إعادة نشر واضحة. للقراية والنسخ الشخصي.', credit: '' },
      { name: 'IslamHouse', status: 'personal', url: 'https://islamhouse.com/',
        note: 'مجاني، بس مالقيتش رخصة إعادة نشر — استأذنهم.', credit: '' },
    ],
  },
  {
    group: 'الصور والفيديوهات', items: [
      { name: 'Pixabay', status: 'ok', inApp: true, url: 'https://pixabay.com/service/license-summary/', note: 'مجاني للاستخدام التجاري ومن غير ذكر المصدر.', credit: '' },
      { name: 'Pexels', status: 'ok', inApp: true, url: 'https://www.pexels.com/license/', note: 'مجاني للاستخدام التجاري ومن غير ذكر المصدر.', credit: '' },
      { name: 'Mixkit', status: 'ok', inApp: true, url: 'https://mixkit.co/license/', note: 'مجاني ومن غير ذكر المصدر.', credit: '' },
      { name: 'Coverr', status: 'ok', inApp: true, url: 'https://coverr.co/license', note: 'مجاني.', credit: '' },
      { name: 'ويكيميديا كومنز / Openverse', status: 'cond', inApp: true, url: 'https://commons.wikimedia.org/', note: 'كل ملف رخصته مكتوبة عليه — لو فيها BY اذكر صاحبها (البرنامج بيكتبهولك).', credit: '' },
      { name: 'Pinterest', status: 'personal', inApp: true, url: 'https://www.pinterest.com/', note: 'الصور ملك أصحابها ومش برخصة حرة. مناظر عامة بس ومن غير علامات مائية.', credit: '' },
    ],
  },
];
