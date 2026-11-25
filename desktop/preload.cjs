const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('linepulseDesktop', {
  isDesktopApp: true,
  platform: process.platform,
});
