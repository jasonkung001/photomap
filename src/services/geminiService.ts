export interface PhotoMetadata {
  id: string;
  name: string;
  date: string;
  lat: number;
  lng: number;
  base64: string;
  animationUrl?: string;
}

export async function generatePhotoAnimation(base64Image: string): Promise<string> {
  const response = await fetch('/api/gemini', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ image: base64Image })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to generate video from backend");
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
