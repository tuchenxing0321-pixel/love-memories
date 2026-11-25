(function () {
  "use strict";
  const menu = document.querySelector(".archive-menu");
  const secret = menu?.querySelector('a[href="secret.html"]');
  if (!menu || !secret || menu.querySelector('a[href="creative.html"]')) return;

  const link = document.createElement("a");
  link.className = "archive-row reveal-line";
  link.href = "creative.html";
  link.innerHTML = '<span class="menu-label"><i class="menu-point top"></i><i class="menu-point right"></i><i class="menu-point bottom"></i><i class="menu-point left"></i><strong>创意</strong></span>';
  menu.insertBefore(link, secret);
})();
