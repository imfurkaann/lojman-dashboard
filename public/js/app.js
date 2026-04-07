// Sidebar toggle (mobile)
document.addEventListener('DOMContentLoaded', function () {
  const sidebarToggle = document.getElementById('sidebarToggle');
  const sidebar = document.getElementById('sidebar');

  if (sidebarToggle && sidebar) {
    let lastToggleAt = 0;

    const toggleSidebar = function (event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }

      // Some mobile browsers fire touch + synthetic click; ignore rapid duplicate toggles.
      const now = Date.now();
      if (now - lastToggleAt < 320) {
        return;
      }
      lastToggleAt = now;

      sidebar.classList.toggle('show');
      sidebarToggle.setAttribute('aria-expanded', sidebar.classList.contains('show') ? 'true' : 'false');
    };

    sidebarToggle.addEventListener('click', toggleSidebar);

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', function (e) {
      if (window.innerWidth <= 768 && sidebar.classList.contains('show')) {
        if (!sidebar.contains(e.target) && e.target !== sidebarToggle && !sidebarToggle.contains(e.target)) {
          sidebar.classList.remove('show');
        }
      }
    });
  }
});
