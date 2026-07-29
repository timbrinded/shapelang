import { resizeImage } from "./worker";

export async function acceptImage(imageId: string): Promise<void> {
  await resizeImage(imageId);
}
