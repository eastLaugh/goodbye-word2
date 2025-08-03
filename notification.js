// 非侵扰式通知系统
class NotificationManager {
  constructor() {
    this.notifications = [];
  }

  show(options = {}) {
    const {
      html = '',
      duration = 3000,
      position = 'top-right'
    } = options;

    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #6750a4, #5a4a8a);
      color: white;
      padding: 12px 16px;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(103, 80, 164, 0.3);
      z-index: 10000;
      font-size: 14px;
      max-width: 300px;
      word-wrap: break-word;
      animation: slideIn 0.3s ease-out;
    `;

    notification.innerHTML = html;
    document.body.appendChild(notification);
    this.notifications.push(notification);

    setTimeout(() => {
      this.remove(notification);
    }, duration);
  }

  remove(notification) {
    if (notification.parentNode) {
      notification.style.animation = 'slideOut 0.3s ease-in';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
        this.notifications = this.notifications.filter(n => n !== notification);
      }, 300);
    }
  }

  clearAll() {
    this.notifications.forEach(notification => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    });
    this.notifications = [];
  }
}

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// 创建全局实例
window.notificationManager = new NotificationManager();
