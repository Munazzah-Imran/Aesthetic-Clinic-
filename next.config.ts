import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces .next/standalone with a minimal server.js for the Docker runtime stage
  output: "standalone",
};

export default nextConfig;
