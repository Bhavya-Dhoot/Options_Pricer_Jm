import { generateThetaDecayCurve } from './bsm.js';

self.onmessage = function (e) {
  const { id, type, params } = e.data;
  
  if (type === 'GENERATE_CURVE') {
    const { S, K, calendarDays, r, sigma, optionType, q } = params;
    try {
      const result = generateThetaDecayCurve(S, K, calendarDays, r, sigma, optionType, q);
      self.postMessage({ id, result });
    } catch (error) {
      self.postMessage({ id, error: error.message });
    }
  }
};
