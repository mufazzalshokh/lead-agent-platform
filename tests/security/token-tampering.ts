export const flipBase64UrlByte = (value: string, byteIndex: number): string => {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || byteIndex < 0 || byteIndex >= bytes.length) {
    throw new TypeError("Expected canonical base64url data and a valid byte index");
  }

  bytes[byteIndex] = (bytes[byteIndex] ?? 0) ^ 1;
  const tampered = bytes.toString("base64url");
  if (tampered === value) {
    throw new TypeError("Token tampering must change the encoded value");
  }
  return tampered;
};
