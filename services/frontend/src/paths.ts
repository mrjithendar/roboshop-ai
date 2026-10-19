// Resolve the mount path from this module URL; works at / and /roboshop/.
export const basePath = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
export function appPath(path: string): string {
  return path.startsWith('/') && !path.startsWith('//') ? basePath + path : path;
}
