// @ts-nocheck
// ---------------------------------------------------------------------------
// JSON Pointer utilities (RFC 6901)
// ---------------------------------------------------------------------------

/**
 * Escape a JSON Pointer reference token per RFC 6901.
 * ~ → ~0, / → ~1
 */function stryNS_9fa48() {
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
export function escapePointerToken(token: string): string {
  if (stryMutAct_9fa48("363")) {
    {}
  } else {
    stryCov_9fa48("363");
    return token.replace(/~/g, stryMutAct_9fa48("364") ? "" : (stryCov_9fa48("364"), "~0")).replace(/\//g, stryMutAct_9fa48("365") ? "" : (stryCov_9fa48("365"), "~1"));
  }
}

/**
 * Build a JSON Pointer path from parent path and a key or index.
 */
export function appendPointer(parent: string, token: string | number): string {
  if (stryMutAct_9fa48("366")) {
    {}
  } else {
    stryCov_9fa48("366");
    if (stryMutAct_9fa48("369") ? typeof token !== "number" : stryMutAct_9fa48("368") ? false : stryMutAct_9fa48("367") ? true : (stryCov_9fa48("367", "368", "369"), typeof token === (stryMutAct_9fa48("370") ? "" : (stryCov_9fa48("370"), "number")))) {
      if (stryMutAct_9fa48("371")) {
        {}
      } else {
        stryCov_9fa48("371");
        return stryMutAct_9fa48("372") ? `` : (stryCov_9fa48("372"), `${parent}/${token}`);
      }
    }
    return stryMutAct_9fa48("373") ? `` : (stryCov_9fa48("373"), `${parent}/${escapePointerToken(token)}`);
  }
}