/**
 * The user guide (/guide), written in English and in Arabic. Both versions have the same sections in the
 * same order, so the table of contents, the role shortcuts and the search work the same in each language.
 */

export interface Block {
  h?: string;
  p?: string;
  list?: string[];
  steps?: string[];
  tip?: string;
}
export interface Section {
  id: string;
  icon: 'start' | 'roles' | 'flow' | 'focal' | 'leader' | 'tmo' | 'pages' | 'bell' | 'faq';
  title: string;
  summary: string;
  blocks: Block[];
}
export interface Faq {
  q: string;
  a: string;
}
export interface Guide {
  title: string;
  lead: string;
  back: string;
  print: string;
  search: string;
  contents: string;
  iam: string;
  roles: { label: string; to: string }[];
  flowTitle: string;
  flow: { name: string; who: string }[];
  flowBack: string;
  faqTitle: string;
  noMatch: string;
  updated: string;
  sections: Section[];
  faq: Faq[];
}

const en: Guide = {
  title: 'User guide',
  lead: 'How to use the TMO Task Register: one shared register for every work group, from each group’s tasks to the consolidated Master Plan.',
  back: 'Back to the application',
  print: 'Print or save as PDF',
  search: 'Search the guide',
  contents: 'Contents',
  iam: 'I am a…',
  roles: [
    { label: 'Focal Point', to: 'focal' },
    { label: 'Team Leader', to: 'leader' },
    { label: 'TMO Officer', to: 'tmo' },
    { label: 'Viewer or member', to: 'pages' },
  ],
  flowTitle: 'The way of a task',
  flow: [
    { name: 'Draft / Needs completion', who: 'Focal Point prepares' },
    { name: 'Ready to include', who: 'Focal Point submits' },
    { name: 'Leader Approved', who: 'Leader approves' },
    { name: 'In Master Plan', who: 'TMO includes' },
  ],
  flowBack: 'Rejected by the leader or sent back by the TMO: back to the Focal Point as Needs completion, with the reason.',
  faqTitle: 'Questions',
  noMatch: 'Nothing in the guide matches your search.',
  updated: 'Guide for version 1.25',
  sections: [
    {
      id: 'start',
      icon: 'start',
      title: 'Getting started',
      summary: 'Sign in, choose your language and find your way around.',
      blocks: [
        {
          h: 'Sign in',
          steps: [
            'Open the application and enter your user name and password.',
            'If the email code is switched on, check your email: enter the 6-digit sign-in code you receive. It is valid for a few minutes and works once. No email? Wait 30 seconds and choose “Send a new code”.',
            'You land on the Overview. The menu on the side shows only the pages your role uses.',
          ],
          tip: 'After 5 wrong attempts the account is locked for 15 minutes. You are signed out automatically after a time without activity, and your password may have to be changed every few months: the administrators set both.',
        },
        {
          h: 'Language and look',
          list: [
            'Switch between English and Arabic with the language button at the top. The whole application, dates and numbers follow.',
            'Your name at the top right opens your account menu: choose a theme (Light, Dark, Desert gold, Aurora night), change your password or sign out.',
            'The amber “Under development” mark beside the page title reminds everyone that the application is still being built: features may change, and the data may be sample data.',
            'Pages work on a phone and a tablet as well as on a computer.',
          ],
        },
        {
          h: 'Your work group',
          p: 'Each person belongs to one or more work groups. The selector at the top of the menu shows the group you are looking at. You see your own group’s register in full, and of other groups only what is linked to yours.',
        },
      ],
    },
    {
      id: 'roles',
      icon: 'roles',
      title: 'Who does what',
      summary: 'The roles in each work group and across the programme.',
      blocks: [
        {
          h: 'In each work group',
          list: [
            'Focal Point: adds the group’s tasks and their activities, keeps them complete, and submits them to the leader. Edits and deletes a task only while it is Draft or Needs completion.',
            'Team Leader: approves or rejects the tasks the Focal Point submits, and the links other groups record with the group. Has full control of the group’s register and can name a delegate while away.',
            'Team Member: reads the group’s register; changes nothing.',
            'Delegate: someone the leader named for a period. Approves or rejects in the leader’s place, and does not edit.',
          ],
        },
        {
          h: 'Across the programme',
          list: [
            'TMO Officer: reads every register, includes approved tasks in the Master Plan or sends them back, and maintains the lists in Reference data.',
            'Global Viewer (for example the committee): reads every register and the Master Plan.',
            'Administrator: everything, including users, sign-in settings, backups and system issues.',
          ],
        },
      ],
    },
    {
      id: 'flow',
      icon: 'flow',
      title: 'How a task reaches the Master Plan',
      summary: 'Five statuses, three people, and a reason whenever work is returned.',
      blocks: [
        {
          steps: [
            'Draft: the Focal Point creates the task and fills it in.',
            'Needs completion: something is missing or the task was returned. The Focal Point completes it.',
            'Ready to include: the Focal Point submitted it. It waits for the leader; the Focal Point may still withdraw it to Draft.',
            'Leader Approved: the leader approved it. It waits for the TMO.',
            'In Master Plan: the TMO included it in the consolidated plan.',
          ],
        },
        {
          p: 'When the leader rejects a task, or the TMO sends it back, it returns to the Focal Point as Needs completion with the reason. Every task page shows this way as a status workflow: each step, who took it and when.',
        },
      ],
    },
    {
      id: 'focal',
      icon: 'focal',
      title: 'For Focal Points',
      summary: 'Create tasks, keep them complete, and submit them to the leader.',
      blocks: [
        {
          h: 'Add a task',
          steps: [
            'Choose “+ New task” at the top of the page.',
            'Describe the task: title, direction, main workstream and sub-objective, and its type (Direct, Enable or Support).',
            'Who it involves: the owner role, and partner groups with what you need from each. Enable and Support tasks also record what they deliver to other groups.',
            'Plan: planned start and finish. A big task gets its activities, with owners, dates and predecessors.',
            'Save. The automatic check runs at once and lists anything to fix.',
          ],
        },
        {
          h: 'Submit to the leader',
          list: [
            'Open the task and fix everything the check marks as not OK (the Data quality check page lists them for the whole group).',
            'Choose “Submit to the leader”. The task becomes Ready to include and the leader is notified by the bell.',
            'Changed your mind before the leader decides? Choose “Withdraw to draft”.',
          ],
        },
        {
          h: 'When work comes back',
          p: 'A task rejected by the leader or sent back by the TMO appears under “Sent back to you” in the bell, with the reason. Open it, choose Edit, make the change and submit it again. A link the other group’s leader rejected is fixed the same way, under Edit › Who it involves.',
        },
        {
          h: 'Delete a task',
          p: 'Only while it is Draft or Needs completion. Its activities are deleted with it, and you can give a reason; the audit trail keeps a record.',
        },
      ],
    },
    {
      id: 'leader',
      icon: 'leader',
      title: 'For Team Leaders',
      summary: 'Decide on your group’s tasks and on the links with other groups.',
      blocks: [
        {
          h: 'The Leader approvals page',
          list: [
            '“Our tasks to approve”: your group’s tasks that are Ready to include. Open a task to read it and its check, then Approve or Reject.',
            '“Other groups’ tasks with us”: what other groups need from your group, or deliver to it. Approve, or Reject with a reason.',
            'Approve goes straight through. Reject asks for a reason (optional but helpful) and a confirmation.',
          ],
          tip: 'The bell shows the same items: one click opens the task with the decision buttons highlighted.',
        },
        {
          h: 'Going on leave: name a delegate',
          steps: [
            'On the Leader approvals page choose “Name a delegate”.',
            'Pick a person of your group, the first and last day (at most 90 days) and, if you like, a note.',
            'Save. The delegate is told by email and, from the first day, sees your group’s approvals in their bell and on the Leader approvals page.',
            'Back early? Choose Cancel next to the delegation: it ends at once.',
          ],
          tip: 'You keep your own rights during the delegation. Prefer someone who did not prepare the tasks.',
        },
      ],
    },
    {
      id: 'tmo',
      icon: 'tmo',
      title: 'For the TMO',
      summary: 'Build the Master Plan and keep the programme’s data in order.',
      blocks: [
        {
          h: 'The TMO Action Center',
          list: [
            'Your own page in the menu, with a count beside it: every task its work group leader approved, the longest waiting first. Each shows its plan dates, direction, partners, activities, who approved it and how many days it has waited.',
            'Filter by Ready to include, To fix first or Waiting 7+ days, or search. Include a task, send it back with a reason, or tick several tasks whose check is OK and include them at once.',
            'Below, the decisions of the last 30 days: what was included, what was sent back and why.',
          ],
        },
        {
          h: 'The Master Plan',
          list: [
            'The Master Plan page lists the Leader Approved tasks waiting for you and the tasks already in the plan, as a list or a Gantt timeline.',
            'Include a task, or send it back to the group with a reason (required). A task already in the plan can also be sent back.',
          ],
        },
        {
          h: 'Following the programme',
          list: [
            'Overview: readiness of every register, data quality, coverage of directions and what is coming up.',
            'Data quality check: every problem the automatic check finds, by group.',
            'Links with other groups: who needs what from whom, and what is agreed.',
            'Reference data: work groups and their leaders, directions, group members and every list.',
          ],
        },
        {
          h: 'The Management board',
          list: [
            'Management board (also for administrators and Global Viewers) holds four reports: the Board summary (headline figures, readiness, the Master Plan, links, what needs attention, every work group); the Master Plan timeline (every included task on a timeline, landscape); Work group scorecards (one page per group); and Dependencies and decisions (who depends on whom, the open links, the decisions of the last 30 days).',
            'Pick a report to see it, then Download PDF saves it in one click, in the language on screen. Download board pack saves all four in one PDF with a cover page. Choose a work group in the side menu for that group’s own reports.',
          ],
        },
      ],
    },
    {
      id: 'pages',
      icon: 'pages',
      title: 'The pages at a glance',
      summary: 'What each page in the menu is for.',
      blocks: [
        {
          list: [
            'Overview: where the registers stand today, with charts you can click for the rows behind them.',
            'Task Register: every task, as a list with filters and search, or as a Gantt timeline (also full screen).',
            'Task activities: the detailed plans of big tasks, with a timeline and the workload by owner.',
            'Data quality check: the automatic check of the template’s rules.',
            'Links with other groups: a diagram of the groups around yours, and the tables of partner rows and contributions.',
            'Leader approvals: the leader’s desk (leaders, delegates, the TMO and administrators).',
            'TMO Action Center: the Leader Approved tasks waiting for the TMO, to include or send back (the TMO and administrators).',
            'Master Plan: the consolidated plan (the TMO, administrators and viewers).',
            'Management board: four reports for the board, each saved as PDF in one click, or all as one board pack (the TMO, administrators and viewers).',
            'Audit trail: every change and decision, who, when, from where, with the values before and after.',
            'Reference data: work groups, directions, group members and the dropdown lists (the TMO and administrators).',
            'User access: accounts, their email and roles; reset a password or unlock an account (administrators).',
            'System settings: outgoing email, the email code at sign-in, password expiry and length, automatic sign-out; each with its own switch (administrators).',
            'Backup & restore, System errors & alerts: for administrators.',
          ],
        },
      ],
    },
    {
      id: 'bell',
      icon: 'bell',
      title: 'Notifications and the status workflow',
      summary: 'The bell tells you what waits for you; each task shows its history.',
      blocks: [
        {
          list: [
            'The bell at the top counts the things waiting for you, grouped as “Sent back to you”, “Waiting for your decision” and “To complete”. New items are marked New.',
            'Click an item: the task opens with a note on what to do, and the button to use is highlighted.',
            'Items leave the list by themselves once the work is done, by you or by someone else.',
            'On each task, the status workflow shows the four stages, who took each step and when, and the full history with every reason.',
          ],
        },
      ],
    },
  ],
  faq: [
    { q: 'I did not receive the sign-in code.', a: 'Check your junk folder, wait 30 seconds and choose “Send a new code”. Use the latest email: an earlier code no longer works. If your account has no email address, ask an administrator to add it.' },
    { q: 'Why can I not edit a task?', a: 'A task can be changed only while it is Draft or Needs completion, by its group’s Focal Point or leader. Once submitted, withdraw it to Draft first (before the leader decides).' },
    { q: 'Why does the leader not see my task?', a: 'The leader sees tasks that are Ready to include. Choose “Submit to the leader” on the task.' },
    { q: 'The leader is on leave and nothing moves.', a: 'The leader can name a delegate on the Leader approvals page; an administrator can do it for them.' },
    { q: 'Where do I see why a task came back?', a: 'In the bell, on the task’s page (at the top and in the status workflow), and in the audit trail.' },
    { q: 'Can I see other groups’ tasks?', a: 'Only those linked to your group, in a short form. The TMO, administrators and viewers see every register.' },
    { q: 'The application only shows a password form.', a: 'Your password expired, or an administrator set a temporary one. Enter the current (or temporary) password and choose a new one: the application opens again at once.' },
    { q: 'I forgot my password or my account is locked.', a: 'Ask an administrator: on the User access page they can unlock your account or give you a temporary password, which you then change.' },
  ],
};

const ar: Guide = {
  title: 'دليل المستخدم',
  lead: 'طريقة استخدام سجل مهام مكتب إدارة التحول: سجل واحد مشترك لكل مجموعات العمل، من مهام كل مجموعة إلى الخطة الرئيسية الموحّدة.',
  back: 'العودة إلى التطبيق',
  print: 'طباعة أو حفظ PDF',
  search: 'ابحث في الدليل',
  contents: 'المحتويات',
  iam: 'أنا…',
  roles: [
    { label: 'نقطة اتصال', to: 'focal' },
    { label: 'قائد فريق', to: 'leader' },
    { label: 'مسؤول مكتب TMO', to: 'tmo' },
    { label: 'مطّلع أو عضو', to: 'pages' },
  ],
  flowTitle: 'مسار المهمة',
  flow: [
    { name: 'مسودة / تحتاج إلى استكمال', who: 'تُعدّها نقطة الاتصال' },
    { name: 'جاهزة للإدراج', who: 'ترفعها نقطة الاتصال' },
    { name: 'معتمدة من القائد', who: 'يعتمدها القائد' },
    { name: 'في الخطة الرئيسية', who: 'يدرجها مكتب TMO' },
  ],
  flowBack: 'إذا رفضها القائد أو أعادها مكتب TMO: تعود إلى نقطة الاتصال بحالة «تحتاج إلى استكمال» مع ذكر السبب.',
  faqTitle: 'أسئلة شائعة',
  noMatch: 'لا يوجد في الدليل ما يطابق بحثك.',
  updated: 'الدليل للإصدار 1.25',
  sections: [
    {
      id: 'start',
      icon: 'start',
      title: 'البدء',
      summary: 'سجّل الدخول، واختر لغتك، وتعرّف على التطبيق.',
      blocks: [
        {
          h: 'تسجيل الدخول',
          steps: [
            'افتح التطبيق وأدخل اسم المستخدم وكلمة المرور.',
            'إذا كان رمز البريد الإلكتروني مفعّلًا فافتح بريدك وأدخل رمز الدخول المكوّن من 6 أرقام. الرمز صالح لدقائق قليلة ويُستخدم مرة واحدة. لم يصلك؟ انتظر 30 ثانية واختر «أرسل رمزًا جديدًا».',
            'تصل إلى صفحة النظرة العامة. تعرض القائمة الجانبية الصفحات التي يستخدمها دورك فقط.',
          ],
          tip: 'بعد 5 محاولات خاطئة يُقفل الحساب لمدة 15 دقيقة. ويُسجَّل خروجك تلقائيًا بعد مدة دون نشاط، وقد يُطلب تغيير كلمة المرور كل بضعة أشهر: يحدد المسؤولون الأمرين.',
        },
        {
          h: 'اللغة والمظهر',
          list: [
            'بدّل بين العربية والإنجليزية من زر اللغة في أعلى الصفحة، ويتبعه التطبيق كاملًا مع التواريخ والأرقام.',
            'يفتح اسمك أعلى الصفحة قائمة حسابك: اختر المظهر (فاتح، داكن، ذهبي الصحراء، ليل الشفق)، أو غيّر كلمة المرور، أو سجّل الخروج.',
            'تذكّر علامة «قيد التطوير» الكهرمانية بجانب عنوان الصفحة بأن التطبيق لا يزال قيد البناء: قد تتغير الميزات، وقد تكون البيانات تجريبية.',
            'تعمل الصفحات على الجوال والجهاز اللوحي كما تعمل على الحاسوب.',
          ],
        },
        {
          h: 'مجموعة عملك',
          p: 'ينتمي كل شخص إلى مجموعة عمل أو أكثر. يُظهر المحدد أعلى القائمة المجموعة التي تتصفحها. ترى سجل مجموعتك كاملًا، ومن المجموعات الأخرى ما يرتبط بمجموعتك فقط.',
        },
      ],
    },
    {
      id: 'roles',
      icon: 'roles',
      title: 'من يفعل ماذا',
      summary: 'الأدوار في كل مجموعة عمل وعلى مستوى البرنامج.',
      blocks: [
        {
          h: 'في كل مجموعة عمل',
          list: [
            'نقطة الاتصال: تضيف مهام المجموعة وأنشطتها، وتحافظ على اكتمالها، وترفعها إلى القائد. تعدّل المهمة أو تحذفها فقط وهي مسودة أو تحتاج إلى استكمال.',
            'قائد الفريق: يعتمد أو يرفض المهام التي ترفعها نقطة الاتصال، والروابط التي تسجلها المجموعات الأخرى مع مجموعته. له التحكم الكامل في سجل المجموعة، ويمكنه تعيين مفوَّض أثناء غيابه.',
            'عضو الفريق: يطّلع على سجل المجموعة دون أي تعديل.',
            'المفوَّض: شخص يعيّنه القائد لفترة محددة، يعتمد أو يرفض نيابةً عنه ولا يعدّل السجل.',
          ],
        },
        {
          h: 'على مستوى البرنامج',
          list: [
            'مسؤول مكتب TMO: يطّلع على كل السجلات، ويُدرج المهام المعتمدة في الخطة الرئيسية أو يعيدها، ويدير القوائم في صفحة البيانات المرجعية.',
            'المطّلع العام (مثل اللجنة): يطّلع على كل السجلات والخطة الرئيسية.',
            'المسؤول: كل الصلاحيات، بما فيها المستخدمون وإعدادات الدخول والنسخ الاحتياطي ومشكلات النظام.',
          ],
        },
      ],
    },
    {
      id: 'flow',
      icon: 'flow',
      title: 'كيف تصل المهمة إلى الخطة الرئيسية',
      summary: 'خمس حالات وثلاثة أشخاص، وسبب مذكور كلما أُعيد العمل.',
      blocks: [
        {
          steps: [
            'مسودة: تنشئ نقطة الاتصال المهمة وتعبّئها.',
            'تحتاج إلى استكمال: ينقصها شيء أو أُعيدت، فتستكملها نقطة الاتصال.',
            'جاهزة للإدراج: رفعتها نقطة الاتصال وهي بانتظار القائد، ويمكن لنقطة الاتصال سحبها إلى المسودة.',
            'معتمدة من القائد: اعتمدها القائد وهي بانتظار مكتب TMO.',
            'في الخطة الرئيسية: أدرجها مكتب TMO في الخطة الموحّدة.',
          ],
        },
        {
          p: 'عندما يرفض القائد المهمة أو يعيدها مكتب TMO، تعود إلى نقطة الاتصال بحالة «تحتاج إلى استكمال» مع ذكر السبب. تعرض صفحة كل مهمة هذا المسار بصريًا: كل خطوة، ومن قام بها، ومتى.',
        },
      ],
    },
    {
      id: 'focal',
      icon: 'focal',
      title: 'لنقاط الاتصال',
      summary: 'أنشئ المهام، وأكملها، وارفعها إلى القائد.',
      blocks: [
        {
          h: 'إضافة مهمة',
          steps: [
            'اختر «+ مهمة جديدة» أعلى الصفحة.',
            'صف المهمة: العنوان، والتوجّه، ومسار العمل الرئيسي، والهدف الفرعي، ونوعها (مباشرة أو تمكين أو دعم).',
            'من تشمل: دور المالك، والمجموعات الشريكة وما تحتاجه من كل منها. وتسجّل مهام التمكين والدعم أيضًا ما تقدمه للمجموعات الأخرى.',
            'الخطة: تاريخا البدء والانتهاء المخطط لهما. وللمهمة الكبيرة أنشطتها بمالكيها وتواريخها والأنشطة السابقة لها.',
            'احفظ. يعمل الفحص التلقائي فورًا ويعرض ما يجب إصلاحه.',
          ],
        },
        {
          h: 'الرفع إلى القائد',
          list: [
            'افتح المهمة وأصلح كل ما يحدده الفحص بأنه غير سليم (تعرضها صفحة فحص جودة البيانات للمجموعة كلها).',
            'اختر «رفع إلى القائد»، فتصبح المهمة جاهزة للإدراج ويصل التنبيه إلى القائد عبر الجرس.',
            'غيّرت رأيك قبل قرار القائد؟ اختر «سحب إلى المسودة».',
          ],
        },
        {
          h: 'عندما يُعاد العمل إليك',
          p: 'تظهر المهمة التي رفضها القائد أو أعادها مكتب TMO تحت «أُعيدت إليك» في الجرس مع السبب. افتحها، واختر «تعديل»، وأجرِ التغيير، ثم ارفعها مجددًا. وتُصحَّح بالطريقة نفسها الروابط التي رفضها قائد المجموعة الأخرى، من «تعديل › من تشمل».',
        },
        {
          h: 'حذف مهمة',
          p: 'فقط وهي مسودة أو تحتاج إلى استكمال. تُحذف أنشطتها معها، ويمكنك ذكر السبب، ويحتفظ سجل التدقيق بالأثر.',
        },
      ],
    },
    {
      id: 'leader',
      icon: 'leader',
      title: 'لقادة الفرق',
      summary: 'قرّر بشأن مهام مجموعتك والروابط مع المجموعات الأخرى.',
      blocks: [
        {
          h: 'صفحة اعتمادات القائد',
          list: [
            '«مهامنا للاعتماد»: مهام مجموعتك الجاهزة للإدراج. افتح المهمة لقراءتها وقراءة فحصها، ثم اعتمد أو ارفض.',
            '«مهام المجموعات الأخرى معنا»: ما تحتاجه المجموعات الأخرى من مجموعتك أو ما تقدمه لها. اعتمد، أو ارفض مع ذكر السبب.',
            'الاعتماد ينفّذ مباشرة، والرفض يطلب سببًا (اختياريًا لكنه مفيد) وتأكيدًا.',
          ],
          tip: 'يعرض الجرس العناصر نفسها: نقرة واحدة تفتح المهمة مع إبراز أزرار القرار.',
        },
        {
          h: 'عند الإجازة: عيّن مفوَّضًا',
          steps: [
            'في صفحة اعتمادات القائد اختر «عيّن مفوَّضًا».',
            'اختر شخصًا من مجموعتك، وأول يوم وآخر يوم (90 يومًا كحد أقصى)، وأضف ملاحظة إن شئت.',
            'احفظ. يصل المفوَّض بريد إلكتروني، ومن اليوم الأول يرى اعتمادات مجموعتك في جرسه وفي صفحة اعتمادات القائد.',
            'عدت مبكرًا؟ اختر «إلغاء» بجانب التفويض فينتهي فورًا.',
          ],
          tip: 'تحتفظ بصلاحياتك خلال التفويض. ويُفضَّل اختيار شخص لم يُعدّ المهام بنفسه.',
        },
      ],
    },
    {
      id: 'tmo',
      icon: 'tmo',
      title: 'لمكتب TMO',
      summary: 'ابنِ الخطة الرئيسية وحافظ على سلامة بيانات البرنامج.',
      blocks: [
        {
          h: 'مركز إجراءات TMO',
          list: [
            'صفحتك الخاصة في القائمة، وبجانبها عدد: كل مهمة اعتمدها قائد مجموعتها، الأطول انتظارًا أولًا. تعرض كل مهمة تواريخها المخططة وتوجهها وشركاءها وأنشطتها ومن اعتمدها وعدد أيام انتظارها.',
            'صفِّ حسب «جاهزة للإدراج» أو «تُصحَّح أولًا» أو «بانتظار 7 أيام فأكثر»، أو ابحث. أدرج المهمة، أو أعدها مع ذكر السبب، أو حدّد عدة مهام فحصها سليم وأدرجها معًا.',
            'وفي الأسفل قرارات آخر 30 يومًا: ما أُدرج، وما أُعيد ولماذا.',
          ],
        },
        {
          h: 'الخطة الرئيسية',
          list: [
            'تعرض صفحة الخطة الرئيسية المهام المعتمدة من القادة بانتظارك والمهام المدرجة في الخطة، كقائمة أو كمخطط زمني (جانت).',
            'أدرج المهمة، أو أعدها إلى المجموعة مع ذكر السبب (إلزامي). ويمكن أيضًا إعادة مهمة مدرجة في الخطة.',
          ],
        },
        {
          h: 'متابعة البرنامج',
          list: [
            'نظرة عامة: جاهزية كل سجل، وجودة البيانات، وتغطية التوجهات، وما هو قادم.',
            'فحص جودة البيانات: كل مشكلة يجدها الفحص التلقائي، حسب المجموعة.',
            'الروابط مع المجموعات الأخرى: من يحتاج ماذا من مَن، وما تم الاتفاق عليه.',
            'البيانات المرجعية: مجموعات العمل وقادتها، والتوجهات، وأعضاء المجموعات، وكل القوائم.',
          ],
        },
        {
          h: 'مجلس الإدارة',
          list: [
            'تضم صفحة مجلس الإدارة (وهي أيضًا للمسؤولين والمطّلعين) أربعة تقارير: ملخص المجلس (الأرقام الرئيسية، والجاهزية، والخطة الرئيسية، والروابط، وما يحتاج إلى متابعة، وكل مجموعة عمل)؛ والمخطط الزمني للخطة الرئيسية (كل مهمة مدرجة على مخطط زمني، بصفحات أفقية)؛ وبطاقات أداء مجموعات العمل (صفحة لكل مجموعة)؛ والاعتماديات والقرارات (من يعتمد على من، والروابط المفتوحة، وقرارات آخر 30 يومًا).',
            'اختر تقريرًا لتراه، ثم يحفظه زر «تنزيل PDF» بنقرة واحدة باللغة الظاهرة على الشاشة. ويحفظ زر «تنزيل حزمة المجلس» التقارير الأربعة في ملف PDF واحد بصفحة غلاف. اختر مجموعة عمل من القائمة الجانبية لتقاريرها الخاصة.',
          ],
        },
      ],
    },
    {
      id: 'pages',
      icon: 'pages',
      title: 'الصفحات في لمحة',
      summary: 'الغرض من كل صفحة في القائمة.',
      blocks: [
        {
          list: [
            'نظرة عامة: وضع السجلات اليوم، مع رسوم بيانية تنقرها لترى الصفوف خلفها.',
            'سجل المهام: كل المهام كقائمة بالتصفية والبحث، أو كمخطط زمني (ويُعرض بملء الشاشة).',
            'أنشطة المهام: الخطط التفصيلية للمهام الكبيرة، مع مخطط زمني وعبء العمل حسب المالك.',
            'فحص جودة البيانات: الفحص التلقائي لقواعد النموذج.',
            'الروابط مع المجموعات الأخرى: مخطط للمجموعات حول مجموعتك، وجداول الشركاء والمساهمات.',
            'اعتمادات القائد: مكتب القائد (القادة والمفوَّضون ومكتب TMO والمسؤولون).',
            'مركز إجراءات TMO: المهام المعتمدة من القادة بانتظار TMO، لإدراجها أو إعادتها (مكتب TMO والمسؤولون).',
            'الخطة الرئيسية: الخطة الموحّدة (مكتب TMO والمسؤولون والمطّلعون).',
            'مجلس الإدارة: أربعة تقارير لمجلس الإدارة، يُحفظ كل منها بصيغة PDF بنقرة واحدة، أو جميعها في حزمة واحدة (مكتب TMO والمسؤولون والمطّلعون).',
            'سجل التدقيق: كل تغيير وقرار، ومن قام به، ومتى، ومن أين، مع القيم قبل التغيير وبعده.',
            'البيانات المرجعية: مجموعات العمل والتوجهات وأعضاء المجموعات والقوائم المنسدلة (مكتب TMO والمسؤولون).',
            'صلاحيات المستخدمين: الحسابات وبريدها الإلكتروني وأدوارها، وإعادة تعيين كلمة المرور وفك قفل الحساب (المسؤولون).',
            'إعدادات النظام: البريد الصادر، ورمز البريد عند الدخول، وانتهاء كلمة المرور وطولها، وتسجيل الخروج التلقائي، ولكلٍّ مفتاح تشغيل وإيقاف (المسؤولون).',
            'النسخ الاحتياطي والاستعادة، وأخطاء وتنبيهات النظام: للمسؤولين.',
          ],
        },
      ],
    },
    {
      id: 'bell',
      icon: 'bell',
      title: 'التنبيهات ومسار الحالة',
      summary: 'يخبرك الجرس بما ينتظرك، وتعرض كل مهمة سجلها.',
      blocks: [
        {
          list: [
            'يعدّ الجرس أعلى الصفحة ما ينتظرك، مقسّمًا إلى «أُعيدت إليك» و«بانتظار قرارك» و«للاستكمال». وتُميَّز العناصر الجديدة بكلمة «جديد».',
            'انقر العنصر: تُفتح المهمة مع ملاحظة بما يجب فعله، ويُبرز الزر المطلوب.',
            'تختفي العناصر من القائمة تلقائيًا بعد إنجاز العمل، سواء أنجزته أنت أو غيرك.',
            'في كل مهمة يعرض مسار الحالة المراحل الأربع، ومن قام بكل خطوة ومتى، والسجل الكامل مع كل سبب.',
          ],
        },
      ],
    },
  ],
  faq: [
    { q: 'لم يصلني رمز الدخول.', a: 'تحقق من مجلد البريد غير المرغوب، وانتظر 30 ثانية ثم اختر «أرسل رمزًا جديدًا». استخدم أحدث رسالة، فالرمز السابق لا يعمل. وإن لم يكن لحسابك بريد إلكتروني فاطلب من المسؤول إضافته.' },
    { q: 'لماذا لا أستطيع تعديل المهمة؟', a: 'تُعدَّل المهمة فقط وهي مسودة أو تحتاج إلى استكمال، من نقطة اتصال مجموعتها أو قائدها. بعد الرفع اسحبها إلى المسودة أولًا (قبل قرار القائد).' },
    { q: 'لماذا لا يرى القائد مهمتي؟', a: 'يرى القائد المهام الجاهزة للإدراج. اختر «رفع إلى القائد» في صفحة المهمة.' },
    { q: 'القائد في إجازة ولا شيء يتحرك.', a: 'يمكن للقائد تعيين مفوَّض من صفحة اعتمادات القائد، ويمكن للمسؤول فعل ذلك نيابةً عنه.' },
    { q: 'أين أرى سبب إعادة المهمة؟', a: 'في الجرس، وفي صفحة المهمة (أعلاها وفي مسار الحالة)، وفي سجل التدقيق.' },
    { q: 'هل أستطيع رؤية مهام المجموعات الأخرى؟', a: 'فقط المهام المرتبطة بمجموعتك وبشكل مختصر. أما مكتب TMO والمسؤولون والمطّلعون فيرون كل السجلات.' },
    { q: 'لا يعرض التطبيق إلا نموذج كلمة المرور.', a: 'انتهت صلاحية كلمة المرور، أو عيّن المسؤول كلمة مؤقتة. أدخل كلمة المرور الحالية (أو المؤقتة) واختر كلمة جديدة، فيفتح التطبيق فورًا.' },
    { q: 'نسيت كلمة المرور أو أُقفل حسابي.', a: 'اطلب من المسؤول: يمكنه من صفحة صلاحيات المستخدمين فك قفل حسابك أو إعطاؤك كلمة مرور مؤقتة تغيّرها بعد ذلك.' },
  ],
};

export const GUIDE = { en, ar };
