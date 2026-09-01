// Test-only stand-in for the plugin SDK.
//
// At runtime the daemon injects the real @getpaseo/plugin, so the package is deliberately not a
// dependency of this repo — and its types come from the generated paseo-plugin.d.ts, not from npm.
// That leaves the unit tests unable to resolve the one *value* the shared contracts import, since
// importing `actions.server` pulls in `actions.shared` -> `defineRpc`. Installing the real package
// would force @getpaseo/client and @getpaseo/protocol to 0.7.0, which would typecheck the
// reconciler against a daemon version this plugin is not developed against.
//
// `defineRpc` is an identity function upstream: it exists to infer types from the definition
// object, not to transform it.
export function defineRpc(definition) {
  return definition;
}
