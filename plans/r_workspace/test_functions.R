# SOBOL' G function -----------------------------------------------------------

#' Sobol' G function
#'
#' @param X A data frame or matrix.
#'
#' @return A numeric vector with the model output.
#' @export
#'
#' @examples
#' A <- randtoolbox::sobol(n = 100, dim = 8)
#' Y <- sobol_Fun(A)
sobol_Fun <- function(X) {
  a <- c(0, 1, 4.5, 9, 99, 99, 99, 99)
  y <- 1
  for (j in 1:8) {
    y <- y * (abs(4 * X[, j] - 2) + a[j])/(1 + a[j])
  }
  return(y)
}

# Ishigami function -----------------------------------------------------------

#' Ishigami function
#'
#' @param X1 First model input.
#' @param X2 Second model input.
#' @param X3 Third model input.
#'
#' @return A numeric vector with the model output.

ishigami <- function(X1, X2, X3) {
  A <- 2
  B <- 1
  sin(X1) + A * sin(X2) ^ 2 + B * X3 ^ 4 * sin(X1)
}

#' Ishigami function
#'
#' @param X A data frame, data table or matrix with the three model inputs
#' required to run the Ishigami function.
#'
#' @return A numeric vector with the model output.
#' @export
#'
#' @examples
#' A <- randtoolbox::sobol(n = 100, dim = 3)
#' Y <- ishigami_Mapply(A)
ishigami_Mapply <- function(X) {
  return(mapply(ishigami,
                X[, 1],
                X[, 2],
                X[, 3]))
}