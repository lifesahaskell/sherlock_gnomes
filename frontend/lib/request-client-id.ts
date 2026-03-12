function parseEnvBool(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function requestClientId(request: Request): string {
  if (parseEnvBool(process.env.TRUST_PROXY_HEADERS)) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) {
        return first;
      }
    }

    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) {
      return realIp;
    }
  }

  return "direct";
}
