// TON Access Pass: платный доступ в закрытый Telegram-канал за TON.
//
// AccessMaster — один на канал: принимает оплату и для каждого покупателя
// (по Telegram ID) разворачивает отдельный контракт Subscription с датой окончания
// доступа. Отдельный контракт на пользователя вместо общего словаря — стандартный
// паттерн TON: состояние мастера не растёт, газ и хранение не дорожают со временем.

message Subscribe {
    queryId: Int as uint64;
    telegramId: Int as uint64;
}

message Extend {
    queryId: Int as uint64;
    period: Int as uint32;
    payer: Address;
}

message Withdraw {
    amount: Int as coins;
}

message SetPrice {
    price: Int as coins;
}

// Сколько мастер отправляет новому Subscription: развёртывание и хранение на годы вперёд
const SUBSCRIPTION_VALUE: Int = ton("0.05");
// Сколько мастер всегда держит у себя на оплату хранения
const MIN_MASTER_BALANCE: Int = ton("0.1");

contract AccessMaster {
    owner: Address;
    price: Int as coins;
    period: Int as uint32;
    sales: Int as uint32;

    init(owner: Address, price: Int, period: Int) {
        self.owner = owner;
        self.price = price;
        self.period = period;
        self.sales = 0;
    }

    // Пустое сообщение: развёртывание мастера и пополнение баланса
    receive() {}

    receive(msg: Subscribe) {
        let ctx: Context = context();
        require(ctx.value >= self.price + SUBSCRIPTION_VALUE, "Not enough TON");
        self.sales += 1;

        let init: StateInit = initOf Subscription(myAddress(), msg.telegramId);
        send(SendParameters {
            to: contractAddress(init),
            value: SUBSCRIPTION_VALUE,
            bounce: false,
            body: Extend { queryId: msg.queryId, period: self.period, payer: ctx.sender }.toCell(),
            code: init.code,
            data: init.data,
        });
    }

    receive(msg: Withdraw) {
        require(sender() == self.owner, "Only owner");
        require(msg.amount > 0, "Nothing to withdraw");
        require(myBalance() - msg.amount >= MIN_MASTER_BALANCE, "Keep balance for storage");
        send(SendParameters {
            to: self.owner,
            value: msg.amount,
            bounce: false,
            mode: SendIgnoreErrors | SendPayFwdFeesSeparately,
        });
    }

    receive(msg: SetPrice) {
        require(sender() == self.owner, "Only owner");
        require(msg.price > 0, "Price must be positive");
        self.price = msg.price;
    }

    get fun price(): Int {
        return self.price;
    }

    get fun period(): Int {
        return self.period;
    }

    get fun sales(): Int {
        return self.sales;
    }

    get fun owner(): Address {
        return self.owner;
    }

    get fun subscriptionAddress(telegramId: Int): Address {
        return contractAddress(initOf Subscription(myAddress(), telegramId));
    }
}

contract Subscription {
    master: Address;
    telegramId: Int as uint64;
    expiresAt: Int as uint32;
    lastPayer: Address?;

    init(master: Address, telegramId: Int) {
        self.master = master;
        self.telegramId = telegramId;
        self.expiresAt = 0;
        self.lastPayer = null;
    }

    // Продление считается от max(сейчас, конец текущей подписки):
    // оплата заранее не сгорает, а прибавляется к сроку
    receive(msg: Extend) {
        require(sender() == self.master, "Only master");
        self.expiresAt = max(now(), self.expiresAt) + msg.period;
        self.lastPayer = msg.payer;
    }

    get fun expiresAt(): Int {
        return self.expiresAt;
    }

    get fun isActive(): Bool {
        return self.expiresAt > now();
    }

    get fun telegramId(): Int {
        return self.telegramId;
    }
}
