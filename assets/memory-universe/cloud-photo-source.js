(function () {
  "use strict";

  const privateImageSignature = { length: 37611, crc32: 1070910964 };
  const crc32Table = Array.from({ length: 256 }, (_, value) => {
    let result = value;
    for (let bit = 0; bit < 8; bit += 1) result = (result & 1) ? 0xedb88320 ^ (result >>> 1) : result >>> 1;
    return result >>> 0;
  });

  function crc32Text(text) {
    let result = 0xffffffff;
    for (let index = 0; index < text.length; index += 1) result = crc32Table[(result ^ text.charCodeAt(index)) & 255] ^ (result >>> 8);
    return (result ^ 0xffffffff) >>> 0;
  }

  function isPrivateImage(image) {
    const data = String(image?.data || "");
    if (data.length !== privateImageSignature.length) return false;
    try {
      return crc32Text(atob(data.slice(data.indexOf(",") + 1))) === privateImageSignature.crc32;
    } catch {
      return false;
    }
  }

  function isPhoto(image) {
    const source = String(image?.data || "");
    const mimeType = String(image?.mimeType || "");
    return Boolean(source) && !isPrivateImage(image) && (!mimeType || mimeType.startsWith("image/"));
  }

  window.MemoryUniversePhotoSource = async function loadMemoryUniversePhotos() {
    if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname) && new URLSearchParams(location.search).get("demo") === "1") {
      return [1018, 1025, 1035, 1043, 1050, 1067, 1074, 1084].map((id, index) => ({
        id: `demo-${id}`,
        src: `/assets/memory-universe/demo-photos/${id}.jpg`,
        thumbnail: `/assets/memory-universe/demo-photos/${id}.jpg`,
        title: `示例照片 ${index + 1}`,
        date: "",
        location: "本地预览",
        description: "仅用于预览页面效果，不属于真实回忆。",
      }));
    }
    if (!window.MemoryLibrary || !window.CloudBaseClient) throw new Error("CloudBase photo library is unavailable");
    const records = await window.MemoryLibrary.all();
    const photos = [];
    records.forEach((record) => {
      (record.images || []).filter(isPhoto).forEach((image) => {
        photos.push({
          id: image.id,
          src: image.data,
          thumbnail: image.thumbnail || image.data,
          title: image.caption || record.title || "一张照片",
          date: image.uploadedAt || record.date || "",
          location: record.place || "",
          description: record.story || "",
        });
      });
    });
    return photos.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  };
})();
