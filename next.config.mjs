/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.1.45", "100.71.29.88"],
  // OneDrive can keep generated files locked, and this repo may run on more
  // than one local port. Let each process opt into an isolated build cache.
  distDir: process.env.NEXT_DIST_DIR ?? ".next-verify",
  output: "export",
  reactStrictMode: true
};

export default nextConfig;
