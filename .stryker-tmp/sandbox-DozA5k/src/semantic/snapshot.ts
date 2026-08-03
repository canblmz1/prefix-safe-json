// @ts-nocheck
// ---------------------------------------------------------------------------
// Snapshot builder — constructs stableValue from committed events
// ---------------------------------------------------------------------------
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
import type { JsonValue, JsonObject, JsonArray, ParserEvent } from "../types.js";

/**
 * Maintains the stable value by processing committed events.
 * Only committed values appear in the stable value.
 */
export class SnapshotBuilder {
  private root: JsonValue | undefined = undefined;
  private hasRoot = stryMutAct_9fa48("2888") ? true : (stryCov_9fa48("2888"), false);

  /**
   * Process a value_committed event and integrate it into the stable value.
   */
  processEvent(event: ParserEvent): void {
    if (stryMutAct_9fa48("2889")) {
      {}
    } else {
      stryCov_9fa48("2889");
      if (stryMutAct_9fa48("2892") ? event.type === "value_committed" : stryMutAct_9fa48("2891") ? false : stryMutAct_9fa48("2890") ? true : (stryCov_9fa48("2890", "2891", "2892"), event.type !== (stryMutAct_9fa48("2893") ? "" : (stryCov_9fa48("2893"), "value_committed")))) return;
      const {
        path,
        value
      } = event;
      if (stryMutAct_9fa48("2896") ? path !== "" : stryMutAct_9fa48("2895") ? false : stryMutAct_9fa48("2894") ? true : (stryCov_9fa48("2894", "2895", "2896"), path === (stryMutAct_9fa48("2897") ? "Stryker was here!" : (stryCov_9fa48("2897"), "")))) {
        if (stryMutAct_9fa48("2898")) {
          {}
        } else {
          stryCov_9fa48("2898");
          // Root value
          this.root = value;
          this.hasRoot = stryMutAct_9fa48("2899") ? false : (stryCov_9fa48("2899"), true);
          return;
        }
      }

      // Parse the JSON Pointer path to navigate to the parent
      const segments = parsePointer(path);
      if (stryMutAct_9fa48("2902") ? segments.length !== 0 : stryMutAct_9fa48("2901") ? false : stryMutAct_9fa48("2900") ? true : (stryCov_9fa48("2900", "2901", "2902"), segments.length === 0)) return;

      // Ensure root exists
      if (stryMutAct_9fa48("2905") ? false : stryMutAct_9fa48("2904") ? true : stryMutAct_9fa48("2903") ? this.hasRoot : (stryCov_9fa48("2903", "2904", "2905"), !this.hasRoot)) {
        if (stryMutAct_9fa48("2906")) {
          {}
        } else {
          stryCov_9fa48("2906");
          // We need a container at root — determine from the first segment
          // This shouldn't happen if events are emitted correctly,
          // because container events come before child value events.
          return;
        }
      }
      const parentSegments = stryMutAct_9fa48("2907") ? segments : (stryCov_9fa48("2907"), segments.slice(0, stryMutAct_9fa48("2908") ? +1 : (stryCov_9fa48("2908"), -1)));
      const lastSegment = segments[stryMutAct_9fa48("2909") ? segments.length + 1 : (stryCov_9fa48("2909"), segments.length - 1)];
      if (stryMutAct_9fa48("2912") ? lastSegment !== undefined : stryMutAct_9fa48("2911") ? false : stryMutAct_9fa48("2910") ? true : (stryCov_9fa48("2910", "2911", "2912"), lastSegment === undefined)) return;
      let target = this.root;
      for (const seg of parentSegments) {
        if (stryMutAct_9fa48("2913")) {
          {}
        } else {
          stryCov_9fa48("2913");
          if (stryMutAct_9fa48("2916") ? target === null && target === undefined : stryMutAct_9fa48("2915") ? false : stryMutAct_9fa48("2914") ? true : (stryCov_9fa48("2914", "2915", "2916"), (stryMutAct_9fa48("2918") ? target !== null : stryMutAct_9fa48("2917") ? false : (stryCov_9fa48("2917", "2918"), target === null)) || (stryMutAct_9fa48("2920") ? target !== undefined : stryMutAct_9fa48("2919") ? false : (stryCov_9fa48("2919", "2920"), target === undefined)))) return;
          if (stryMutAct_9fa48("2923") ? typeof target === "object" || !Array.isArray(target) : stryMutAct_9fa48("2922") ? false : stryMutAct_9fa48("2921") ? true : (stryCov_9fa48("2921", "2922", "2923"), (stryMutAct_9fa48("2925") ? typeof target !== "object" : stryMutAct_9fa48("2924") ? true : (stryCov_9fa48("2924", "2925"), typeof target === (stryMutAct_9fa48("2926") ? "" : (stryCov_9fa48("2926"), "object")))) && (stryMutAct_9fa48("2927") ? Array.isArray(target) : (stryCov_9fa48("2927"), !Array.isArray(target))))) {
            if (stryMutAct_9fa48("2928")) {
              {}
            } else {
              stryCov_9fa48("2928");
              target = (target as JsonObject)[seg];
            }
          } else if (stryMutAct_9fa48("2930") ? false : stryMutAct_9fa48("2929") ? true : (stryCov_9fa48("2929", "2930"), Array.isArray(target))) {
            if (stryMutAct_9fa48("2931")) {
              {}
            } else {
              stryCov_9fa48("2931");
              const idx = parseInt(seg, 10);
              if (stryMutAct_9fa48("2933") ? false : stryMutAct_9fa48("2932") ? true : (stryCov_9fa48("2932", "2933"), isNaN(idx))) return;
              target = target[idx];
            }
          } else {
            if (stryMutAct_9fa48("2934")) {
              {}
            } else {
              stryCov_9fa48("2934");
              return; // Can't navigate into scalar
            }
          }
        }
      }
      if (stryMutAct_9fa48("2937") ? target === null && target === undefined : stryMutAct_9fa48("2936") ? false : stryMutAct_9fa48("2935") ? true : (stryCov_9fa48("2935", "2936", "2937"), (stryMutAct_9fa48("2939") ? target !== null : stryMutAct_9fa48("2938") ? false : (stryCov_9fa48("2938", "2939"), target === null)) || (stryMutAct_9fa48("2941") ? target !== undefined : stryMutAct_9fa48("2940") ? false : (stryCov_9fa48("2940", "2941"), target === undefined)))) return;
      if (stryMutAct_9fa48("2944") ? typeof target === "object" || !Array.isArray(target) : stryMutAct_9fa48("2943") ? false : stryMutAct_9fa48("2942") ? true : (stryCov_9fa48("2942", "2943", "2944"), (stryMutAct_9fa48("2946") ? typeof target !== "object" : stryMutAct_9fa48("2945") ? true : (stryCov_9fa48("2945", "2946"), typeof target === (stryMutAct_9fa48("2947") ? "" : (stryCov_9fa48("2947"), "object")))) && (stryMutAct_9fa48("2948") ? Array.isArray(target) : (stryCov_9fa48("2948"), !Array.isArray(target))))) {
        if (stryMutAct_9fa48("2949")) {
          {}
        } else {
          stryCov_9fa48("2949");
          (target as JsonObject)[lastSegment] = value;
        }
      } else if (stryMutAct_9fa48("2951") ? false : stryMutAct_9fa48("2950") ? true : (stryCov_9fa48("2950", "2951"), Array.isArray(target))) {
        if (stryMutAct_9fa48("2952")) {
          {}
        } else {
          stryCov_9fa48("2952");
          const idx = parseInt(lastSegment, 10);
          if (stryMutAct_9fa48("2955") ? false : stryMutAct_9fa48("2954") ? true : stryMutAct_9fa48("2953") ? isNaN(idx) : (stryCov_9fa48("2953", "2954", "2955"), !isNaN(idx))) {
            if (stryMutAct_9fa48("2956")) {
              {}
            } else {
              stryCov_9fa48("2956");
              (target as JsonArray)[idx] = value;
            }
          }
        }
      }
    }
  }

  /**
   * Initialize the root as an object container.
   */
  initRootObject(): void {
    if (stryMutAct_9fa48("2957")) {
      {}
    } else {
      stryCov_9fa48("2957");
      if (stryMutAct_9fa48("2960") ? false : stryMutAct_9fa48("2959") ? true : stryMutAct_9fa48("2958") ? this.hasRoot : (stryCov_9fa48("2958", "2959", "2960"), !this.hasRoot)) {
        if (stryMutAct_9fa48("2961")) {
          {}
        } else {
          stryCov_9fa48("2961");
          this.root = {};
          this.hasRoot = stryMutAct_9fa48("2962") ? false : (stryCov_9fa48("2962"), true);
        }
      }
    }
  }

  /**
   * Initialize the root as an array container.
   */
  initRootArray(): void {
    if (stryMutAct_9fa48("2963")) {
      {}
    } else {
      stryCov_9fa48("2963");
      if (stryMutAct_9fa48("2966") ? false : stryMutAct_9fa48("2965") ? true : stryMutAct_9fa48("2964") ? this.hasRoot : (stryCov_9fa48("2964", "2965", "2966"), !this.hasRoot)) {
        if (stryMutAct_9fa48("2967")) {
          {}
        } else {
          stryCov_9fa48("2967");
          this.root = stryMutAct_9fa48("2968") ? ["Stryker was here"] : (stryCov_9fa48("2968"), []);
          this.hasRoot = stryMutAct_9fa48("2969") ? false : (stryCov_9fa48("2969"), true);
        }
      }
    }
  }

  /**
   * Initialize a nested container at the given path.
   */
  initContainer(path: string, type: "object" | "array"): void {
    if (stryMutAct_9fa48("2970")) {
      {}
    } else {
      stryCov_9fa48("2970");
      if (stryMutAct_9fa48("2973") ? false : stryMutAct_9fa48("2972") ? true : stryMutAct_9fa48("2971") ? this.hasRoot : (stryCov_9fa48("2971", "2972", "2973"), !this.hasRoot)) return;
      const segments = parsePointer(path);
      if (stryMutAct_9fa48("2976") ? segments.length !== 0 : stryMutAct_9fa48("2975") ? false : stryMutAct_9fa48("2974") ? true : (stryCov_9fa48("2974", "2975", "2976"), segments.length === 0)) return;
      const parentSegments = stryMutAct_9fa48("2977") ? segments : (stryCov_9fa48("2977"), segments.slice(0, stryMutAct_9fa48("2978") ? +1 : (stryCov_9fa48("2978"), -1)));
      const lastSegment = segments[stryMutAct_9fa48("2979") ? segments.length + 1 : (stryCov_9fa48("2979"), segments.length - 1)];
      if (stryMutAct_9fa48("2982") ? lastSegment !== undefined : stryMutAct_9fa48("2981") ? false : stryMutAct_9fa48("2980") ? true : (stryCov_9fa48("2980", "2981", "2982"), lastSegment === undefined)) return;
      let target = this.root;
      for (const seg of parentSegments) {
        if (stryMutAct_9fa48("2983")) {
          {}
        } else {
          stryCov_9fa48("2983");
          if (stryMutAct_9fa48("2986") ? target === null && target === undefined : stryMutAct_9fa48("2985") ? false : stryMutAct_9fa48("2984") ? true : (stryCov_9fa48("2984", "2985", "2986"), (stryMutAct_9fa48("2988") ? target !== null : stryMutAct_9fa48("2987") ? false : (stryCov_9fa48("2987", "2988"), target === null)) || (stryMutAct_9fa48("2990") ? target !== undefined : stryMutAct_9fa48("2989") ? false : (stryCov_9fa48("2989", "2990"), target === undefined)))) return;
          if (stryMutAct_9fa48("2993") ? typeof target === "object" || !Array.isArray(target) : stryMutAct_9fa48("2992") ? false : stryMutAct_9fa48("2991") ? true : (stryCov_9fa48("2991", "2992", "2993"), (stryMutAct_9fa48("2995") ? typeof target !== "object" : stryMutAct_9fa48("2994") ? true : (stryCov_9fa48("2994", "2995"), typeof target === (stryMutAct_9fa48("2996") ? "" : (stryCov_9fa48("2996"), "object")))) && (stryMutAct_9fa48("2997") ? Array.isArray(target) : (stryCov_9fa48("2997"), !Array.isArray(target))))) {
            if (stryMutAct_9fa48("2998")) {
              {}
            } else {
              stryCov_9fa48("2998");
              target = (target as JsonObject)[seg];
            }
          } else if (stryMutAct_9fa48("3000") ? false : stryMutAct_9fa48("2999") ? true : (stryCov_9fa48("2999", "3000"), Array.isArray(target))) {
            if (stryMutAct_9fa48("3001")) {
              {}
            } else {
              stryCov_9fa48("3001");
              const idx = parseInt(seg, 10);
              if (stryMutAct_9fa48("3003") ? false : stryMutAct_9fa48("3002") ? true : (stryCov_9fa48("3002", "3003"), isNaN(idx))) return;
              target = target[idx];
            }
          } else {
            if (stryMutAct_9fa48("3004")) {
              {}
            } else {
              stryCov_9fa48("3004");
              return;
            }
          }
        }
      }
      if (stryMutAct_9fa48("3007") ? target === null && target === undefined : stryMutAct_9fa48("3006") ? false : stryMutAct_9fa48("3005") ? true : (stryCov_9fa48("3005", "3006", "3007"), (stryMutAct_9fa48("3009") ? target !== null : stryMutAct_9fa48("3008") ? false : (stryCov_9fa48("3008", "3009"), target === null)) || (stryMutAct_9fa48("3011") ? target !== undefined : stryMutAct_9fa48("3010") ? false : (stryCov_9fa48("3010", "3011"), target === undefined)))) return;
      const newContainer = (stryMutAct_9fa48("3014") ? type !== "object" : stryMutAct_9fa48("3013") ? false : stryMutAct_9fa48("3012") ? true : (stryCov_9fa48("3012", "3013", "3014"), type === (stryMutAct_9fa48("3015") ? "" : (stryCov_9fa48("3015"), "object")))) ? {} : stryMutAct_9fa48("3016") ? ["Stryker was here"] : (stryCov_9fa48("3016"), []);
      if (stryMutAct_9fa48("3019") ? typeof target === "object" || !Array.isArray(target) : stryMutAct_9fa48("3018") ? false : stryMutAct_9fa48("3017") ? true : (stryCov_9fa48("3017", "3018", "3019"), (stryMutAct_9fa48("3021") ? typeof target !== "object" : stryMutAct_9fa48("3020") ? true : (stryCov_9fa48("3020", "3021"), typeof target === (stryMutAct_9fa48("3022") ? "" : (stryCov_9fa48("3022"), "object")))) && (stryMutAct_9fa48("3023") ? Array.isArray(target) : (stryCov_9fa48("3023"), !Array.isArray(target))))) {
        if (stryMutAct_9fa48("3024")) {
          {}
        } else {
          stryCov_9fa48("3024");
          (target as JsonObject)[lastSegment] = newContainer;
        }
      } else if (stryMutAct_9fa48("3026") ? false : stryMutAct_9fa48("3025") ? true : (stryCov_9fa48("3025", "3026"), Array.isArray(target))) {
        if (stryMutAct_9fa48("3027")) {
          {}
        } else {
          stryCov_9fa48("3027");
          const idx = parseInt(lastSegment, 10);
          if (stryMutAct_9fa48("3030") ? false : stryMutAct_9fa48("3029") ? true : stryMutAct_9fa48("3028") ? isNaN(idx) : (stryCov_9fa48("3028", "3029", "3030"), !isNaN(idx))) {
            if (stryMutAct_9fa48("3031")) {
              {}
            } else {
              stryCov_9fa48("3031");
              (target as JsonArray)[idx] = newContainer;
            }
          }
        }
      }
    }
  }

  /**
   * Remove a path from the stable value (for unclosed containers during snapshot).
   */
  removePath(path: string): void {
    if (stryMutAct_9fa48("3032")) {
      {}
    } else {
      stryCov_9fa48("3032");
      if (stryMutAct_9fa48("3035") ? !this.hasRoot && path === "" : stryMutAct_9fa48("3034") ? false : stryMutAct_9fa48("3033") ? true : (stryCov_9fa48("3033", "3034", "3035"), (stryMutAct_9fa48("3036") ? this.hasRoot : (stryCov_9fa48("3036"), !this.hasRoot)) || (stryMutAct_9fa48("3038") ? path !== "" : stryMutAct_9fa48("3037") ? false : (stryCov_9fa48("3037", "3038"), path === (stryMutAct_9fa48("3039") ? "Stryker was here!" : (stryCov_9fa48("3039"), "")))))) return;
      const segments = parsePointer(path);
      if (stryMutAct_9fa48("3042") ? segments.length !== 0 : stryMutAct_9fa48("3041") ? false : stryMutAct_9fa48("3040") ? true : (stryCov_9fa48("3040", "3041", "3042"), segments.length === 0)) return;
      const parentSegments = stryMutAct_9fa48("3043") ? segments : (stryCov_9fa48("3043"), segments.slice(0, stryMutAct_9fa48("3044") ? +1 : (stryCov_9fa48("3044"), -1)));
      const lastSegment = segments[stryMutAct_9fa48("3045") ? segments.length + 1 : (stryCov_9fa48("3045"), segments.length - 1)];
      if (stryMutAct_9fa48("3048") ? lastSegment !== undefined : stryMutAct_9fa48("3047") ? false : stryMutAct_9fa48("3046") ? true : (stryCov_9fa48("3046", "3047", "3048"), lastSegment === undefined)) return;
      let target = this.root;
      let parent: unknown = null;
      let parentKey: string | number = stryMutAct_9fa48("3049") ? "Stryker was here!" : (stryCov_9fa48("3049"), "");
      for (const seg of parentSegments) {
        if (stryMutAct_9fa48("3050")) {
          {}
        } else {
          stryCov_9fa48("3050");
          if (stryMutAct_9fa48("3053") ? target === null && target === undefined : stryMutAct_9fa48("3052") ? false : stryMutAct_9fa48("3051") ? true : (stryCov_9fa48("3051", "3052", "3053"), (stryMutAct_9fa48("3055") ? target !== null : stryMutAct_9fa48("3054") ? false : (stryCov_9fa48("3054", "3055"), target === null)) || (stryMutAct_9fa48("3057") ? target !== undefined : stryMutAct_9fa48("3056") ? false : (stryCov_9fa48("3056", "3057"), target === undefined)))) return;
          parent = target;
          if (stryMutAct_9fa48("3060") ? typeof target === "object" || !Array.isArray(target) : stryMutAct_9fa48("3059") ? false : stryMutAct_9fa48("3058") ? true : (stryCov_9fa48("3058", "3059", "3060"), (stryMutAct_9fa48("3062") ? typeof target !== "object" : stryMutAct_9fa48("3061") ? true : (stryCov_9fa48("3061", "3062"), typeof target === (stryMutAct_9fa48("3063") ? "" : (stryCov_9fa48("3063"), "object")))) && (stryMutAct_9fa48("3064") ? Array.isArray(target) : (stryCov_9fa48("3064"), !Array.isArray(target))))) {
            if (stryMutAct_9fa48("3065")) {
              {}
            } else {
              stryCov_9fa48("3065");
              parentKey = seg;
              target = (target as JsonObject)[seg];
            }
          } else if (stryMutAct_9fa48("3067") ? false : stryMutAct_9fa48("3066") ? true : (stryCov_9fa48("3066", "3067"), Array.isArray(target))) {
            if (stryMutAct_9fa48("3068")) {
              {}
            } else {
              stryCov_9fa48("3068");
              const idx = parseInt(seg, 10);
              if (stryMutAct_9fa48("3070") ? false : stryMutAct_9fa48("3069") ? true : (stryCov_9fa48("3069", "3070"), isNaN(idx))) return;
              parentKey = idx;
              target = target[idx];
            }
          } else {
            if (stryMutAct_9fa48("3071")) {
              {}
            } else {
              stryCov_9fa48("3071");
              return;
            }
          }
        }
      }
      if (stryMutAct_9fa48("3074") ? target !== null || target !== undefined : stryMutAct_9fa48("3073") ? false : stryMutAct_9fa48("3072") ? true : (stryCov_9fa48("3072", "3073", "3074"), (stryMutAct_9fa48("3076") ? target === null : stryMutAct_9fa48("3075") ? true : (stryCov_9fa48("3075", "3076"), target !== null)) && (stryMutAct_9fa48("3078") ? target === undefined : stryMutAct_9fa48("3077") ? true : (stryCov_9fa48("3077", "3078"), target !== undefined)))) {
        if (stryMutAct_9fa48("3079")) {
          {}
        } else {
          stryCov_9fa48("3079");
          if (stryMutAct_9fa48("3082") ? typeof target === "object" || !Array.isArray(target) : stryMutAct_9fa48("3081") ? false : stryMutAct_9fa48("3080") ? true : (stryCov_9fa48("3080", "3081", "3082"), (stryMutAct_9fa48("3084") ? typeof target !== "object" : stryMutAct_9fa48("3083") ? true : (stryCov_9fa48("3083", "3084"), typeof target === (stryMutAct_9fa48("3085") ? "" : (stryCov_9fa48("3085"), "object")))) && (stryMutAct_9fa48("3086") ? Array.isArray(target) : (stryCov_9fa48("3086"), !Array.isArray(target))))) {
            if (stryMutAct_9fa48("3087")) {
              {}
            } else {
              stryCov_9fa48("3087");
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const {
                [lastSegment]: removed,
                ...rest
              } = target as JsonObject;
              if (stryMutAct_9fa48("3090") ? parent !== null : stryMutAct_9fa48("3089") ? false : stryMutAct_9fa48("3088") ? true : (stryCov_9fa48("3088", "3089", "3090"), parent === null)) {
                if (stryMutAct_9fa48("3091")) {
                  {}
                } else {
                  stryCov_9fa48("3091");
                  this.root = rest;
                }
              } else if (stryMutAct_9fa48("3093") ? false : stryMutAct_9fa48("3092") ? true : (stryCov_9fa48("3092", "3093"), Array.isArray(parent))) {
                if (stryMutAct_9fa48("3094")) {
                  {}
                } else {
                  stryCov_9fa48("3094");
                  (parent as JsonArray)[parentKey as number] = rest;
                }
              } else {
                if (stryMutAct_9fa48("3095")) {
                  {}
                } else {
                  stryCov_9fa48("3095");
                  (parent as JsonObject)[parentKey as string] = rest;
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Get a deep clone of the current stable value.
   */
  getStableValue(): JsonValue | undefined {
    if (stryMutAct_9fa48("3096")) {
      {}
    } else {
      stryCov_9fa48("3096");
      if (stryMutAct_9fa48("3099") ? false : stryMutAct_9fa48("3098") ? true : stryMutAct_9fa48("3097") ? this.hasRoot : (stryCov_9fa48("3097", "3098", "3099"), !this.hasRoot)) return undefined;
      return deepClone(this.root as JsonValue);
    }
  }
  get hasRootValue(): boolean {
    if (stryMutAct_9fa48("3100")) {
      {}
    } else {
      stryCov_9fa48("3100");
      return this.hasRoot;
    }
  }
}

/**
 * Parse a JSON Pointer string into segments.
 * Handles ~0 (~) and ~1 (/) unescaping.
 */
function parsePointer(pointer: string): string[] {
  if (stryMutAct_9fa48("3101")) {
    {}
  } else {
    stryCov_9fa48("3101");
    if (stryMutAct_9fa48("3104") ? pointer !== "" : stryMutAct_9fa48("3103") ? false : stryMutAct_9fa48("3102") ? true : (stryCov_9fa48("3102", "3103", "3104"), pointer === (stryMutAct_9fa48("3105") ? "Stryker was here!" : (stryCov_9fa48("3105"), "")))) return stryMutAct_9fa48("3106") ? ["Stryker was here"] : (stryCov_9fa48("3106"), []);
    if (stryMutAct_9fa48("3109") ? false : stryMutAct_9fa48("3108") ? true : stryMutAct_9fa48("3107") ? pointer.startsWith("/") : (stryCov_9fa48("3107", "3108", "3109"), !(stryMutAct_9fa48("3110") ? pointer.endsWith("/") : (stryCov_9fa48("3110"), pointer.startsWith(stryMutAct_9fa48("3111") ? "" : (stryCov_9fa48("3111"), "/")))))) return stryMutAct_9fa48("3112") ? ["Stryker was here"] : (stryCov_9fa48("3112"), []);
    return stryMutAct_9fa48("3113") ? pointer.split("/").map(seg => seg.replace(/~1/g, "/").replace(/~0/g, "~")) : (stryCov_9fa48("3113"), pointer.slice(1).split(stryMutAct_9fa48("3114") ? "" : (stryCov_9fa48("3114"), "/")).map(stryMutAct_9fa48("3115") ? () => undefined : (stryCov_9fa48("3115"), seg => seg.replace(/~1/g, stryMutAct_9fa48("3116") ? "" : (stryCov_9fa48("3116"), "/")).replace(/~0/g, stryMutAct_9fa48("3117") ? "" : (stryCov_9fa48("3117"), "~")))));
  }
}

/**
 * Deep clone a JSON value.
 */
function deepClone(value: JsonValue): JsonValue {
  if (stryMutAct_9fa48("3118")) {
    {}
  } else {
    stryCov_9fa48("3118");
    if (stryMutAct_9fa48("3121") ? value === null && typeof value !== "object" : stryMutAct_9fa48("3120") ? false : stryMutAct_9fa48("3119") ? true : (stryCov_9fa48("3119", "3120", "3121"), (stryMutAct_9fa48("3123") ? value !== null : stryMutAct_9fa48("3122") ? false : (stryCov_9fa48("3122", "3123"), value === null)) || (stryMutAct_9fa48("3125") ? typeof value === "object" : stryMutAct_9fa48("3124") ? false : (stryCov_9fa48("3124", "3125"), typeof value !== (stryMutAct_9fa48("3126") ? "" : (stryCov_9fa48("3126"), "object")))))) {
      if (stryMutAct_9fa48("3127")) {
        {}
      } else {
        stryCov_9fa48("3127");
        return value;
      }
    }
    if (stryMutAct_9fa48("3129") ? false : stryMutAct_9fa48("3128") ? true : (stryCov_9fa48("3128", "3129"), Array.isArray(value))) {
      if (stryMutAct_9fa48("3130")) {
        {}
      } else {
        stryCov_9fa48("3130");
        return value.map(deepClone);
      }
    }
    const result: JsonObject = {};
    for (const key of Object.keys(value)) {
      if (stryMutAct_9fa48("3131")) {
        {}
      } else {
        stryCov_9fa48("3131");
        result[key] = deepClone((value as JsonObject)[key] as JsonValue);
      }
    }
    return result;
  }
}