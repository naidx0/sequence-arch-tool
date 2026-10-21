/** The release workflow keeps package.json semver and supplies a numeric fourth part separately. */
export function buildInfoVersion(pkg, appBuild) {
  if (typeof pkg.sequenceVersion === 'string' && pkg.sequenceVersion) return pkg.sequenceVersion;
  const build = appBuild?.build;
  return typeof build === 'number' && Number.isInteger(build) && build > 0 && /^\d+\.\d+\.\d+$/.test(pkg.version)
    ? `${pkg.version}.${build}`
    : pkg.version;
}
