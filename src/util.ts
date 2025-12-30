export function checkInput(i: string): boolean {
  if (
    i.toLowerCase().includes("@channel") ||
    i.toLowerCase().includes("<!channel>") ||
    i.toLowerCase().includes("@everyone") ||
    i.toLowerCase().includes("<!everyone>") ||
    i.toLowerCase().includes("@here") ||
    i.toLowerCase().includes("<!here>")
  ) {
    return false;
  }

  return true;
}

export function stripMentions(text: string): string {
  return text
    .replace(/@channel/gi, "")
    .replace(/<!channel>/gi, "")
    .replace(/@everyone/gi, "")
    .replace(/<!everyone>/gi, "")
    .replace(/@here/gi, "")
    .replace(/<!here>/gi, "")
    .trim();
}
