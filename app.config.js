// The Android SDK key is supplied at build time, never committed or logged.
module.exports = ({ config }) => {
  const candidate = (process.env.SAFEMELINK_ANDROID_MAPS_API_KEY || '').trim();
  const key = candidate && !/process\.env|\$\{|[\r\n]/.test(candidate) ? candidate : null;
  return {
    ...config,
    plugins: (config.plugins || []).some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === './plugins/withEmergencyDialerQueries.cjs')
      ? config.plugins : [...(config.plugins || []), './plugins/withEmergencyDialerQueries.cjs'],
    android: key ? {
      ...config.android,
      config: {
        ...config.android?.config,
        googleMaps: { ...config.android?.config?.googleMaps, apiKey: key },
      },
    } : config.android,
    extra: { ...config.extra, androidMapsConfigured: !!key },
  };
};
