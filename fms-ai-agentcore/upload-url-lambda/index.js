const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
});

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "OPTIONS,POST",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return response(200, { message: "OK" });
    }

    const body = JSON.parse(event.body || "{}");

    const fileName = body.file_name || body.fileName || body.filename;
    const contentType =
      body.content_type || body.contentType || "application/octet-stream";

    if (!fileName) {
      return response(400, {
        message: "file_name required",
      });
    }

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `uploads/${Date.now()}-${safeFileName}`;

    const command = new PutObjectCommand({
      Bucket: process.env.BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: 300,
    });

    return response(200, {
      upload_url: uploadUrl,
      uploadUrl,
      key,
    });
  } catch (error) {
    console.error(error);

    return response(500, {
      message: error.message,
    });
  }
};