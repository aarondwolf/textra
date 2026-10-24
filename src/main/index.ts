import { app } from 'electron';
import { isAbsolute } from 'node:path';
import { PRODUCT_NAME } from '../shared/api';

// Acquire the profile-scoped lock before importing services or accessing their stores.
app.setName(PRODUCT_NAME);
const profile = !app.isPackaged ? process.env.TEXTRA_USER_DATA_DIR : undefined;
if (profile) {
  if (!isAbsolute(profile)) throw new Error('Test user data directory must be absolute.');
  app.setPath('userData', profile);
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const application = import('./application');
  app.on('second-instance', () => {
    void application
      .then(({ focusOrCreateWindow }) => focusOrCreateWindow())
      .catch(() => undefined);
  });
  void application.catch(() => {
    console.error('TeXtra could not initialize.');
    app.exit(1);
  });
}
