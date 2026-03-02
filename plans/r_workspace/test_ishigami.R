# Test Ishigami with soboljansen

.libPaths('~/R/library')
library(randtoolbox)
library(sensitivity)

source("test_functions.R")

# Analytical values for Ishigami with a=7, b=0.1
# S1: [0.3139, 0.4424, 0]
# ST: [0.5576, 0.4424, 0.2437]

cat("Testing Ishigami function with soboljansen\n\n")

for (N in c(1024, 4096)) {
  cat(paste0("N = ", N, "\n"))
  
  # Generate two independent Sobol sequences
  X1 <- sobol(N, dim = 3, scrambling = 0, seed = 1)
  X2 <- sobol(N, dim = 3, scrambling = 0, seed = 2)
  
  # Scale to [-pi, pi]
  X1_scaled <- X1 * 2 * pi - pi
  X2_scaled <- X2 * 2 * pi - pi
  
  # Create soboljansen object
  x <- soboljansen(model = NULL, X1 = X1_scaled, X2 = X2_scaled)
  
  # Evaluate model on design matrix
  y <- ishigami_Mapply(x$X)
  
  # Tell the results
  tell(x, y)
  
  cat("First-order indices (S):\n")
  print(x$S)
  cat("\nTotal-order indices (T):\n")
  print(x$T)
  
  cat("\nErrors:\n")
  analytical_S1 <- c(0.3139, 0.4424, 0)
  analytical_ST <- c(0.5576, 0.4424, 0.2437)
  cat("S1 errors:", round(abs(x$S - analytical_S1), 4), "\n")
  cat("ST errors:", round(abs(x$T - analytical_ST), 4), "\n")
  cat("\n")
  
  # Print V values (partial variances)
  cat("Partial variances (V):\n")
  print(x$V)
  cat("\n----------------------------------------\n\n")
}
