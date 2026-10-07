export function isOpenInternalAccess(environment = process.env) {
  return environment.PLANKING_OPEN_ACCESS?.trim().toLowerCase() !== 'false';
}
