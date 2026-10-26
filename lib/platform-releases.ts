// The platform's own changelog — not to be confused with product releases
// (lib/releases.ts, /releases). Every platform release adds its entry at the
// TOP of this list in the PR that ships it; the sidebar shows
// RELEASES[0].version and links to /changelog. Keep package.json "version" in
// step (x.y.0 for x.y).

export type PlatformRelease = {
  version: string;
  date: string; // YYYY-MM-DD
  title: {en: string; ar: string};
  items: {en: string[]; ar: string[]};
};

export const RELEASES: PlatformRelease[] = [
  {
    version: '0.2',
    date: '2026-10-26',
    title: {
      en: "Know what's mine, know who we're selling to",
      ar: 'اعرف ما يخصّني، واعرف لمن نبيع'
    },
    items: {
      en: [
        'My work: every open task assigned to you across all products and the General backlog, as a list grouped by product or a To do / In progress / Blocked / Done kanban. Moving a card to Done completes the task in its product.',
        'Quick capture for tasks, with overdue and due-today counters scoped to you.',
        'Waiting on me: lifecycle gates ready for your decision, agent proposals, overdue product reviews, unanswered mentions, and your stale or closing deals — each leaves the list once resolved.',
        'A live badge on My work: what is waiting on you plus your overdue tasks.',
        'Sales: accounts, contacts and deals in one B2B pipeline (Lead → Meeting → Discovery/Demo → Proposal → Negotiation → Closed Won / Lost) for product and consultation deals, with a kanban, a list view and filters.',
        'Every stage move is logged; moving backward or closing lost requires a reason. A deal with no current next action for over a week is flagged stale.',
        'Winning a product deal marks the account as a customer of that product; winning a consultation deal opens an engagement recording who owns the code.',
        'Notifications for accounts, deals and tasks: assigned, due, overdue and closed — in the bell and by email, with new switches in Settings. Due-date reminders for work you own are always emailed.',
        'This release log, linked from the version in the sidebar.'
      ],
      ar: [
        'عملي: كل المهام المفتوحة المسندة إليك في جميع المنتجات والقائمة العامة، كقائمة مجمّعة حسب المنتج أو كلوحة كانبان (للتنفيذ / قيد التنفيذ / متوقفة / منجزة). نقل البطاقة إلى «منجزة» يُنجز المهمة في منتجها.',
        'إضافة سريعة للمهام، مع عدّادات للمتأخر والمستحق اليوم خاصة بك.',
        'بانتظاري: بوابات دورة الحياة الجاهزة لقرارك، ومقترحات الوكلاء، ومراجعات المنتجات المتأخرة، والإشارات غير المردود عليها، وصفقاتك الراكدة أو المتوقع إغلاقها — وتختفي كل منها عند معالجتها.',
        'شارة حيّة على «عملي»: ما ينتظرك مع مهامك المتأخرة.',
        'المبيعات: الحسابات وجهات الاتصال والصفقات في مسار مبيعات واحد للشركات (عميل محتمل ← اجتماع ← استكشاف/عرض ← عرض سعر ← تفاوض ← ربح / خسارة) لصفقات المنتجات والاستشارات، مع كانبان وعرض كقائمة وتصفية.',
        'تُسجَّل كل حركة بين المراحل؛ ويتطلب الرجوع للخلف أو الإغلاق بالخسارة ذكر السبب. وتُميَّز الصفقة الراكدة إن بقيت أكثر من أسبوع بلا إجراء تالٍ.',
        'ربح صفقة منتج يجعل الحساب عميلاً لذلك المنتج؛ وربح صفقة استشارية يفتح ارتباطاً يسجّل من يملك الشيفرة.',
        'إشعارات للحسابات والصفقات والمهام: الإسناد والاستحقاق والتأخر والإغلاق — في الجرس وبالبريد، مع خيارات جديدة في الإعدادات. تذكيرات الاستحقاق للأعمال التي تملكها تُرسل بالبريد دائماً.',
        'سجل الإصدارات هذا، مع رابط من رقم الإصدار في الشريط الجانبي.'
      ]
    }
  },
  {
    version: '0.1',
    date: '2026-10-05',
    title: {en: 'Mission Control beta', ar: 'النسخة التجريبية من مركز القيادة'},
    items: {
      en: [
        'Bilingual (English / Arabic) console with full RTL support, admin-approved sign-up, and settings with an admin area.',
        'Product registry with derived health and stage, owners, review cadence and an append-only status timeline.',
        'Work items: product and General tasks with subtasks, assignees, due dates, document attachments and completion notes, plus an All tasks view.',
        'Implementation lifecycle: six phases with risk-tiered gates and uploaded evidence; Governance with coverage, stuck products, waivers and the gate log.',
        'Release management: per-product releases with scoped work, a risk-tiered checklist and a waiver-gated ship step.',
        'Channels, threads, direct messages and mentions, with product channels that the record posts into.',
        'Agents that propose and never commit — every proposal decided by a person — plus a workspace assistant and MCP access for personal clients.',
        'Company knowledge base, GitHub mirroring of lifecycle evidence, and task notifications in the bell with opt-in email.'
      ],
      ar: [
        'واجهة ثنائية اللغة (العربية / الإنجليزية) بدعم كامل للاتجاه من اليمين لليسار، وتسجيل بموافقة المشرف، وإعدادات مع قسم للإدارة.',
        'سجل المنتجات بحالة ومرحلة مشتقّتين، ومالكين، ودورية مراجعة، وخط زمني للتحديثات لا يُعدَّل.',
        'المهام: مهام المنتجات والمهام العامة مع مهام فرعية ومسؤولين ومواعيد ومرفقات وملاحظات إنجاز، وعرض لكل المهام.',
        'دورة حياة التنفيذ: ست مراحل ببوابات حسب مستوى المخاطر وأدلة مرفوعة؛ والحوكمة بالتغطية والمنتجات المتعثرة والاستثناءات وسجل البوابات.',
        'إدارة الإصدارات: إصدارات لكل منتج بنطاق عمل وقائمة تحقق حسب المخاطر وخطوة إطلاق مشروطة.',
        'القنوات والمحادثات الفرعية والرسائل المباشرة والإشارات، مع قنوات للمنتجات تُنشر فيها أحداث السجل.',
        'وكلاء يقترحون ولا ينفّذون — كل مقترح يقرّه شخص — مع مساعد لمساحة العمل ووصول MCP للعملاء الشخصيين.',
        'قاعدة معرفة للشركة، ونسخ أدلة دورة الحياة إلى GitHub، وإشعارات المهام في الجرس مع بريد اختياري.'
      ]
    }
  }
];

export const CURRENT_VERSION = RELEASES[0].version;
