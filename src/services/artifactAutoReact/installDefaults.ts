/**
 * Wire densable Qem mint + Cji open into arm deps (product host entry).
 * @deprecated Prefer installArtifactAutoReactProduct from bootstrap.ts
 */
export {
  installArtifactAutoReactProduct,
  installDefaultArtifactLiveArmDeps,
  isArtifactAutoReactProductInstalled,
  resetArtifactAutoReactProductForTests,
  type InstallProductOpts as InstallLiveArmDepsOpts,
} from './bootstrap.js'
