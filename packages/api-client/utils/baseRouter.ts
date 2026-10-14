import { type AnyContractRouter, type ContractRouterClient } from "@orpc/contract"

export class Router<T extends AnyContractRouter> {
	constructor(protected readonly client: ContractRouterClient<T>) {}
}
