# Security and data handling

PLANKING MVP does not require user accounts or secret API keys. Uploaded JSON is sent to the same-origin `/api/analyze` endpoint for calculation and is not persisted by the application code. Do not add Naver session cookies, authorization tokens, or other private browser credentials to the repository or calibration files.
