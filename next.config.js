/** @type {import('next').NextConfig} */
const nextConfig = {
  // jsforce y aws-sdk usan APIs de Node; aseguramos que no se empaqueten al cliente
  serverExternalPackages: ["jsforce", "pg", "bcryptjs"],
};

module.exports = nextConfig;
