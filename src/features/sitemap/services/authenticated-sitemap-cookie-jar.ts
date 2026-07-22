export class TemporaryCookieJar {
  private readonly cookies = new Map<string, string>();

  constructor(seed: string) {
    seed.split(";").forEach((pair) => this.setPair(pair));
  }

  getHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  accept(response: Response) {
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const values = headers.getSetCookie?.() ?? [];
    if (values.length === 0) {
      const combined = response.headers.get("set-cookie");
      if (combined) {
        values.push(combined);
      }
    }
    values.forEach((value) => this.setPair(value.split(";", 1)[0] ?? ""));
  }

  clear() {
    this.cookies.clear();
  }

  private setPair(value: string) {
    const separator = value.indexOf("=");
    if (separator <= 0) {
      return;
    }
    const name = value.slice(0, separator).trim();
    const cookieValue = value.slice(separator + 1).trim();
    if (!name) {
      return;
    }
    if (!cookieValue) {
      this.cookies.delete(name);
      return;
    }
    this.cookies.set(name, cookieValue);
  }
}
