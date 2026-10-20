export const handler = async (): Promise<{ statusCode: number; body: string }> => ({
  statusCode: 501,
  body: '{"error":"not_implemented"}',
});
