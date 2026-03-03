function sendHandledError(res, scope, error, fallbackMessage = 'Erro interno') {
  if (error?.statusCode && error?.code) {
    if (error.statusCode >= 500) {
      const status = Number(error.statusCode) || 500;
      const publicMessage =
        error.publicMessage || (status === 503 ? 'Servico temporariamente indisponivel' : fallbackMessage);

      console.error(`[${scope}] erro interno`, {
        message: error?.message,
        code: error?.code,
        status,
      });

      return res.status(status).json({
        success: false,
        error: error.code || 'INTERNAL_ERROR',
        message: publicMessage,
      });
    }

    const payload = {
      success: false,
      error: error.code,
      message: error.message,
    };

    if (error.meta) {
      payload.details = error.meta;
    }

    return res.status(error.statusCode).json(payload);
  }

  console.error(`[${scope}] erro interno`, {
    message: error?.message,
    code: error?.code,
  });

  return res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: fallbackMessage,
  });
}

module.exports = {
  sendHandledError,
};
