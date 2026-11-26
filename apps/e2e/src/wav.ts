const SAMPLE_RATE = 44_100;
const TONE_HZ = 440;
const TONE_AMPLITUDE = 0.5;

/**
 * A mono 16-bit PCM WAV of a sine tone `seconds` long: a RIFF header, then the
 * samples. No imports, so the smoke can use it with nothing but Bun.
 */
export function toneWav(seconds = 2): Uint8Array<ArrayBuffer> {
  const samples = SAMPLE_RATE * seconds;
  const dataBytes = samples * 2;
  const bytes = new ArrayBuffer(44 + dataBytes);
  const wav = new DataView(bytes);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      wav.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  wav.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, SAMPLE_RATE, true);
  wav.setUint32(28, SAMPLE_RATE * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples; i++) {
    const sample =
      Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE) * TONE_AMPLITUDE;
    wav.setInt16(44 + i * 2, Math.round(sample * 0x7fff), true);
  }
  return new Uint8Array(bytes);
}
