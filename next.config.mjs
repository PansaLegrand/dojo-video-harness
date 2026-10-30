/** Product-aligned Next 15/Webpack host. SaaS deployment policy stays in DojoClip. */
const config = {
  reactStrictMode: true,
  experimental: { cpus: 1 },
  webpack(config) {
    config.devtool = false;
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};
export default config;
