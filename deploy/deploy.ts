import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedPrismVote = await deploy("PrismVote", {
    from: deployer,
    log: true,
  });

  console.log(`PrismVote contract: `, deployedPrismVote.address);
};
export default func;
func.id = "deploy_prismVote"; // id required to prevent reexecution
func.tags = ["PrismVote"];
