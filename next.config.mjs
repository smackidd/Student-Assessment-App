/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // OneDrive can keep the conventional .next directory locked after a local
  // dev server exits. A project-specific cache keeps builds deterministic.
  distDir: ".next-verify",
  output: "export",
  reactStrictMode: true
};

export default nextConfig;
