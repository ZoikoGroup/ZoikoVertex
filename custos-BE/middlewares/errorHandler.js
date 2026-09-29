function errorHandler(error, _req, res, _next) {
  console.error(error);

  // Multer errors
  if (error.name === "MulterError") {
    const messages = {
      LIMIT_FILE_SIZE: "File is too large. Maximum size is 10 MB.",
      LIMIT_UNEXPECTED_FILE: "Unexpected file field.",
    };
    return res.status(400).json({
      success: false,
      message: messages[error.code] || error.message,
    });
  }

  // Sequelize errors
  if (error.name === "SequelizeValidationError") {
    return res.status(400).json({
      success: false,
      message: error.errors.map((e) => e.message).join(", "),
    });
  }

  if (error.name === "SequelizeUniqueConstraintError") {
    return res.status(409).json({
      success: false,
      message: "A record with that value already exists.",
    });
  }

  if (error.name === "SequelizeForeignKeyConstraintError") {
    return res.status(400).json({
      success: false,
      message: "Invalid reference: related record does not exist.",
    });
  }

  if (error.name === "SequelizeDatabaseError") {
    return res.status(400).json({
      success: false,
      message: "Database error.",
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Request is too large.",
    });
  }

  // Never leak internal error details (DB, stack, provider messages) to clients.
  const status = error.statusCode || error.status || 500;
  const exposeMessage = error.expose || (status >= 400 && status < 500);
  return res.status(status).json({
    success: false,
    message: exposeMessage && error.message ? error.message : "Something went wrong.",
  });
}

module.exports = { errorHandler };