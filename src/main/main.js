/* ==========================================================================
   main.js — главный процесс Electron: окно, меню, мост к хранилищу.
   Здесь нет ни строчки интерфейса: разметка и экраны живут в renderer,
   а сюда вынесено всё, что требует доступа к диску.
   ========================================================================== */

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { createStorage } = require('./storage');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const BOUNDS_FILE = path.join(app.getPath('userData'), 'window.json');

let storage = null;
let win = null;

/* --- размеры окна между запусками ---------------------------------------- */

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(BOUNDS_FILE, 'utf8'));
    if (Number.isFinite(b.width) && Number.isFinite(b.height)) return b;
  } catch (_) {}
  return { width: 1280, height: 820 };
}

function saveBounds() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  try {
    fs.writeFileSync(BOUNDS_FILE, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch (_) {}
}

/* --- окно ----------------------------------------------------------------- */

function createWindow() {
  const bounds = loadBounds();

  win = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 560,
    backgroundColor: '#161009',          // цвет фона приложения: без белой вспышки при старте
    show: false,
    title: 'Journeyman — кодекс мастера',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,            // renderer не видит Node напрямую
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  if (bounds.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // внешние ссылки уходят в системный браузер, а не открывают окно поверх приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* --- меню ------------------------------------------------------------------ */

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Сохранить кодекс в файл…',
          accelerator: 'CmdOrCtrl+S',
          click: () => win && win.webContents.send('command', 'export'),
        },
        {
          label: 'Загрузить кодекс из файла…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win && win.webContents.send('command', 'import'),
        },
        { type: 'separator' },
        {
          label: 'Показать папку с данными',
          click: () => shell.openPath(storage.dataDir),
        },
        {
          label: 'Сведения о хранилище…',
          click: async () => {
            const { usage } = storage.estimate();
            await dialog.showMessageBox(win, {
              type: 'info',
              title: 'Хранилище',
              message: 'Данные лежат на диске',
              detail: `Папка: ${storage.dataDir}\nЗанято: ${(usage / 1048576).toFixed(1)} МБ\n\n`
                + 'Папку можно скопировать целиком — это и есть резервная копия.',
              buttons: ['Понятно'],
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'resetZoom', label: 'Обычный размер' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Во весь экран' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'Journeyman',
            message: 'Journeyman — кодекс мастера',
            detail: `Версия ${app.getVersion()}\nElectron ${process.versions.electron}\n\n`
              + 'Хранилище материалов для мастеров настольных ролевых игр.\n'
              + 'Работает без интернета, данные не покидают компьютер.',
            buttons: ['Закрыть'],
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* --- мост к хранилищу ------------------------------------------------------ */

// Ровно те методы, что были у веб-версии: имена сохранены, чтобы экраны
// работали без единой правки.
const EXPOSED = [
  'listSpaces', 'getSpace', 'createSpace', 'updateSpace', 'deleteSpace', 'touchSpace',
  'listNodes', 'getNode', 'createNode', 'updateNode', 'deleteNode',
  'listLinks', 'createLink', 'deleteLink',
  'addAsset', 'listAssets', 'getAsset', 'deleteAsset', 'estimate',
];

function wireStorage() {
  storage = createStorage(DATA_DIR);
  ipcMain.handle('db', (_event, method, args) => {
    if (!EXPOSED.includes(method)) throw new Error(`Неизвестный метод хранилища: ${method}`);
    return storage[method](...args);
  });

  // Сохранение кодекса наружу. Renderer не имеет доступа к диску, поэтому
  // и диалог, и запись делаются здесь. Путь выбирает пользователь — это
  // единственное место, где программа пишет за пределы своей папки.
  ipcMain.handle('saveFile', async (_event, name, bytes) => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Сохранить кодекс',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Кодекс Journeyman', extensions: ['zip'] }],
    });
    if (canceled || !filePath) return { ok: false };
    await fs.promises.writeFile(filePath, Buffer.from(bytes));
    return { ok: true, path: filePath };
  });
}

/* --- запуск ---------------------------------------------------------------- */

// вторая копия программы не нужна: она открыла бы те же файлы на запись
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    wireStorage();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
