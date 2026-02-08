import mjml2html from 'mjml';

export function renderMjml(mjmlString: string): { html: string; errors: any[] } {
  const result = mjml2html(mjmlString, {
    validationLevel: 'soft',
    minify: false,
  });
  return { html: result.html, errors: result.errors };
}

export function validateMjml(mjmlString: string): { valid: boolean; errors: any[] } {
  try {
    const result = mjml2html(mjmlString, { validationLevel: 'strict' });
    return { valid: result.errors.length === 0, errors: result.errors };
  } catch (e) {
    return { valid: false, errors: [{ message: e instanceof Error ? e.message : 'Invalid MJML' }] };
  }
}
