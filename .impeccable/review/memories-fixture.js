(function () {
  const image = (id, data, caption) => ({ id, data, caption, uploadedAt: '2024-02-14' });
  const records = [
    {
      id: 'review-girl', kind: 'photo', title: '普通的一天', date: '2024-02-14', story: '', place: '', eventType: 'minor',
      images: [image('review-girl-image', '../../assets/girl-first-frame.jpg', 'nono 的照片')]
    },
    {
      id: 'review-star', kind: 'photo', title: '属于我们的标记', date: '2024-03-14', story: '', place: '', eventType: 'minor',
      images: [image('review-star-image', '../../assets/site-logo.png', 'nono 与 txx 的标记')]
    },
    {
      id: 'review-boy', kind: 'photo', title: '一起收藏', date: '2024-04-14', story: '', place: '', eventType: 'minor',
      images: [image('review-boy-image', '../../assets/boy-first-frame.jpg', 'txx 的照片')]
    },
    {
      id: 'review-event-one', kind: 'event', isExample: true, title: '故事从这里开始', date: '2025-11-30',
      story: '这是可替换的示例事件。把它改成属于你们的第一段记忆吧。', place: '', eventType: 'major',
      images: [
        image('review-event-girl', '../../assets/girl-first-frame.jpg', '示例照片'),
        image('review-event-boy', '../../assets/boy-first-frame.jpg', '示例照片'),
        image('review-event-star', '../../assets/site-logo.png', '示例照片')
      ]
    },
    {
      id: 'review-event-two', kind: 'event', isExample: true, title: '一次普通却珍贵的见面', date: '2026-01-05',
      story: '示例内容：也许是一次散步、一顿晚饭，或一句后来一直记得的话。', place: '', eventType: 'minor', images: []
    },
    {
      id: 'review-event-three', kind: 'event', isExample: true, title: '把今天也收藏起来', date: '2026-04-19',
      story: '示例内容可以直接编辑，也可以删除后记录真实的你们。', place: '', eventType: 'major', images: []
    }
  ];
  window.MemoryLibrary.all = async () => structuredClone(records);
})();
