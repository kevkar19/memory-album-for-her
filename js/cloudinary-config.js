// Cloudinary unsigned upload config — a cloud name + unsigned preset is
// meant to be public. Lock down abuse via preset restrictions in the
// Cloudinary console (see README.md), not by hiding these values.
export const CLOUDINARY_CLOUD_NAME = "z0pt1gga";
export const CLOUDINARY_UPLOAD_PRESET = "memory_album_for_her";
export const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
// Cloudinary handles audio files (mp3, etc.) under the "video" resource type.
export const CLOUDINARY_AUDIO_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
