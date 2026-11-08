/** Product-aligned Next 15/Webpack host. SaaS deployment policy stays in DojoClip. */
const config = {
  reactStrictMode: true,
  experimental: { cpus: 1 },
  webpack(config) {
    config.devtool = false;
    // Source workspaces use Node-compatible .js specifiers; installed JS stays first.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, ".js": [".js", ".ts", ".tsx"] };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};
export default config;
