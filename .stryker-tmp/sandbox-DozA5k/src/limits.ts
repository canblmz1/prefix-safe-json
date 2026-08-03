// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import type { ParserLimits } from "./types.js";

/** Default resource limits. */
export const DEFAULT_LIMITS: Readonly<ParserLimits> = stryMutAct_9fa48("1126") ? {} : (stryCov_9fa48("1126"), {
  maxInputBytes: stryMutAct_9fa48("1127") ? 8 * 1024 / 1024 : (stryCov_9fa48("1127"), (stryMutAct_9fa48("1128") ? 8 / 1024 : (stryCov_9fa48("1128"), 8 * 1024)) * 1024),
  // 8 MB
  maxDepth: 128,
  maxStringBytes: stryMutAct_9fa48("1129") ? 4 * 1024 / 1024 : (stryCov_9fa48("1129"), (stryMutAct_9fa48("1130") ? 4 / 1024 : (stryCov_9fa48("1130"), 4 * 1024)) * 1024),
  // 4 MB
  maxQueuedEvents: 10_000,
  maxTrailingDataBytes: 65536 // 64 KB
});