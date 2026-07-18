export function cleanContextMessages(messages: any[]): any[] {
  return messages.map(m => {
    if (m.role === "assistant" && Array.isArray(m.content)) {
      return {
        ...m,
        content: m.content.map((b: any) => {
          if (b.type === "text" && typeof b.text === "string") {
            if (b.text.startsWith("⚡ ")) {
              const newlineIndex = b.text.indexOf("\n");
              if (newlineIndex !== -1) {
                return { ...b, text: b.text.substring(newlineIndex + 1) };
              } else {
                return { ...b, text: "" };
              }
            }
          }
          return b;
        }),
      };
    }
    return m;
  });
}
