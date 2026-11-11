import pkg from '../../package.json';

export function getCliVersion(): string {
  return typeof __MEMORIX_VERSION__ !== 'undefined'
    ? __MEMORIX_VERSION__
    : pkg.version;
}
